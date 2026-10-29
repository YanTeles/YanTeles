// Generates stats.svg and langs.svg from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... node stats.mjs <username> <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user, outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;

const C = {
  bg: "#0a0616",
  stroke: "#2a1b4d",
  title: "#c4b5fd",
  text: "#e9d5ff",
  muted: "#8b7fb8",
  accent: "#a855f7",
};

const query = `
query($login: String!, $after: String) {
  user(login: $login) {
    name
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
    }
    pullRequests { totalCount }
    issues { totalCount }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]) { totalCount }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function gql(variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user;
}

const first = await gql({ login: user });
const repos = [...first.repositories.nodes];
let page = first.repositories.pageInfo;
while (page.hasNextPage) {
  const next = await gql({ login: user, after: page.endCursor });
  repos.push(...next.repositories.nodes);
  page = next.repositories.pageInfo;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const card = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'Segoe UI', Ubuntu, sans-serif">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${C.bg}" stroke="${C.stroke}"/>
  <text x="25" y="35" fill="${C.title}" font-size="18" font-weight="600">${esc(title)}</text>
  ${body}
</svg>
`;

// Stats card
const cc = first.contributionsCollection;
const stats = [
  ["Total Stars", repos.reduce((n, r) => n + r.stargazerCount, 0)],
  ["Commits (this year)", cc.totalCommitContributions + cc.restrictedContributionsCount],
  ["Pull Requests", first.pullRequests.totalCount],
  ["Issues", first.issues.totalCount],
  ["Contributed to", first.repositoriesContributedTo.totalCount],
  ["Public Repos", first.repositories.totalCount],
];
const statRows = stats
  .map(([label, value], i) => {
    const y = 68 + i * 22;
    return `<circle cx="31" cy="${y - 5}" r="4" fill="${C.accent}"/>
  <text x="45" y="${y}" fill="${C.text}" font-size="14">${label}:</text>
  <text x="375" y="${y}" fill="${C.text}" font-size="14" font-weight="700" text-anchor="end">${value}</text>`;
  })
  .join("\n  ");

// Languages card
const sizes = new Map();
for (const r of repos) {
  for (const { size, node } of r.languages.edges) {
    const cur = sizes.get(node.name) ?? { size: 0, color: node.color ?? C.accent };
    cur.size += size;
    sizes.set(node.name, cur);
  }
}
const total = [...sizes.values()].reduce((n, l) => n + l.size, 0) || 1;
const langs = [...sizes.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 6)
  .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));
const shown = langs.reduce((n, l) => n + l.pct, 0) || 1;

let x = 25;
const barWidth = 350;
const bar = langs
  .map((l) => {
    const w = (l.pct / shown) * barWidth;
    const seg = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
    x += w;
    return seg;
  })
  .join("");
const legend = langs
  .map((l, i) => {
    const lx = i % 2 === 0 ? 25 : 210;
    const ly = 95 + Math.floor(i / 2) * 25;
    return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
  <text x="${lx + 16}" y="${ly}" fill="${C.text}" font-size="12">${esc(l.name)} <tspan fill="${C.muted}">${l.pct.toFixed(1)}%</tspan></text>`;
  })
  .join("\n  ");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stats.svg"), card(400, 200, `${first.name || user}'s GitHub Stats`, statRows));
writeFileSync(
  join(outDir, "langs.svg"),
  card(
    400,
    200,
    "Most Used Languages",
    `<clipPath id="r"><rect x="25" y="0" width="${barWidth}" height="8" rx="4"/></clipPath>
  <g transform="translate(0 55)" clip-path="url(#r)">${bar}</g>
  ${legend}`
  )
);
console.log("Generated stats.svg and langs.svg");
