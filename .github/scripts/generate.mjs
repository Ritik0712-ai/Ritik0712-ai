// Generates the live parts of the profile README from GitHub's API, so the
// profile doesn't depend on third-party stat widgets (which rate-limit, go
// down, and get stuck in GitHub's image cache).
//
// Writes:
//   assets/stats-{dark,light}.svg     contributions, streaks, repos
//   assets/calendar-{dark,light}.svg  contribution heatmap, last 12 months
//   README.md                         the block between the RECENT markers
//
// Runs in .github/workflows/profile.yml. Needs GH_TOKEN; with a personal
// token (PROFILE_TOKEN secret) private contributions are counted too.
// Local test without network: FIXTURE=path/to/user.json node .github/scripts/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const LOGIN = 'Ritik0712-ai';

const QUERY = `
query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
    recent: repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 6, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { name description url pushedAt primaryLanguage { name } }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

async function loadUser() {
  if (process.env.FIXTURE) return JSON.parse(readFileSync(process.env.FIXTURE, 'utf8'));
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': LOGIN },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) throw new Error(`GitHub API error: ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user;
}

const user = await loadUser();
const calendar = user.contributionsCollection.contributionCalendar;
const days = calendar.weeks.flatMap((w) => w.contributionDays);
const today = new Date().toISOString().slice(0, 10);

// Streaks. A day with no contributions yet *today* doesn't break the
// current streak — it only breaks once the day is over.
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (days[i].date === today && current === 0) continue;
  else break;
}
let longest = 0;
let run = 0;
for (const d of days) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
const activeDays = days.filter((d) => d.contributionCount > 0).length;

const THEMES = {
  dark: { text: '#e6edf3', muted: '#8b949e', border: '#30363d', accent: '#818cf8', levels: ['#161b22', '#2e2a6b', '#4338ca', '#6366f1', '#a5b4fc'] },
  light: { text: '#1f2328', muted: '#656d76', border: '#d0d7de', accent: '#4f46e5', levels: ['#ebedf0', '#c7d2fe', '#818cf8', '#6366f1', '#3730a3'] },
};
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function statsSvg(t) {
  const cells = [
    [calendar.totalContributions, 'Contributions (past year)'],
    [`${current} day${current === 1 ? '' : 's'}`, 'Current streak'],
    [`${longest} day${longest === 1 ? '' : 's'}`, 'Longest streak (past year)'],
    [activeDays, 'Active days (past year)'],
    [user.repositories.totalCount, 'Public repositories'],
  ];
  const w = 840;
  const col = w / cells.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="120" viewBox="0 0 ${w} 120" font-family="${FONT}">
  <title>GitHub stats for ${LOGIN}</title>
  <rect x="0.5" y="0.5" width="${w - 1}" height="119" rx="10" fill="none" stroke="${t.border}"/>
  ${cells
    .map(
      ([v, label], i) => `<g transform="translate(${col * i + col / 2} 0)" text-anchor="middle">
    <text y="58" font-size="28" font-weight="600" fill="${i === 1 ? t.accent : t.text}">${esc(v)}</text>
    <text y="84" font-size="12" fill="${t.muted}">${esc(label)}</text>
  </g>`,
    )
    .join('\n  ')}
  <text x="${w - 12}" y="110" font-size="10" fill="${t.muted}" text-anchor="end">Updated ${esc(stamp)} IST</text>
</svg>`;
}

function calendarSvg(t) {
  const size = 11;
  const gap = 3;
  const step = size + gap;
  const left = 30;
  const top = 22;
  const weeks = calendar.weeks;
  const w = left + weeks.length * step + 10;
  const h = top + 7 * step + 34;
  let months = '';
  let lastMonth = -1;
  weeks.forEach((wk, i) => {
    const m = new Date(wk.contributionDays[0].date).getUTCMonth();
    if (m !== lastMonth && i < weeks.length - 2) {
      months += `<text x="${left + i * step}" y="${top - 8}">${new Date(Date.UTC(2000, m, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}</text>`;
      lastMonth = m;
    }
  });
  const rects = weeks
    .map((wk, i) =>
      wk.contributionDays
        .map((d) => {
          const row = new Date(d.date).getUTCDay();
          return `<rect x="${left + i * step}" y="${top + row * step}" width="${size}" height="${size}" rx="2" fill="${t.levels[LEVEL[d.contributionLevel] ?? 0]}"><title>${d.contributionCount} on ${d.date}</title></rect>`;
        })
        .join(''),
    )
    .join('');
  const legendX = w - 10 - 5 * step - 70;
  const legend = t.levels.map((c, i) => `<rect x="${legendX + 34 + i * step}" y="${h - 22}" width="${size}" height="${size}" rx="2" fill="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" font-size="10" fill="${t.muted}">
  <title>${calendar.totalContributions} contributions in the last year</title>
  ${months}
  <text x="0" y="${top + 1 * step + 9}">Mon</text><text x="0" y="${top + 3 * step + 9}">Wed</text><text x="0" y="${top + 5 * step + 9}">Fri</text>
  ${rects}
  <text x="${left}" y="${h - 13}">${calendar.totalContributions} contributions in the last year</text>
  <text x="${legendX}" y="${h - 13}">Less</text>${legend}<text x="${legendX + 34 + 5 * step + 4}" y="${h - 13}">More</text>
</svg>`;
}

for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(`assets/stats-${name}.svg`, statsSvg(t));
  writeFileSync(`assets/calendar-${name}.svg`, calendarSvg(t));
}

// Recently active public repositories, rewritten in place in README.md.
const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
const recent = user.recent.nodes
  .filter((r) => r.name.toLowerCase() !== LOGIN.toLowerCase() && !r.name.toLowerCase().endsWith('.github.io'))
  .slice(0, 5)
  .map((r) => `| [**${r.name}**](${r.url}) | ${esc(r.description ?? '—')} | ${r.primaryLanguage?.name ?? '—'} | ${ago(r.pushedAt)} |`)
  .join('\n');
const table = `| Repository | About | Language | Last push |\n|---|---|---|---|\n${recent}`;

const readme = readFileSync('README.md', 'utf8');
const updated = readme.replace(/(<!-- RECENT:START -->)[\s\S]*?(<!-- RECENT:END -->)/, `$1\n${table}\n$2`);
if (updated === readme && !readme.includes('<!-- RECENT:START -->')) throw new Error('RECENT markers missing from README.md');
writeFileSync('README.md', updated);

console.log(`contributions=${calendar.totalContributions} current=${current} longest=${longest} repos=${user.repositories.totalCount}`);
