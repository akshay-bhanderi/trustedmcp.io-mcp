import type { Advisory, RegistryDetail, RegistrySummary, ServerDetail, ServerSummary } from './api.js';

/** Closing line on every answer that shows a grade. */
export const GRADE_NOTE =
  'TrustedMCP grades are an assessment from public signals (login, upkeep, known CVEs, connection), a starting point for your own review, not an audit of the code.';

export const REQUEST_REVIEW = 'https://trustedmcp.io/submit';

const STATE: Record<string, string> = { full: 'full marks', part: 'part marks', empty: 'no marks' };

export function serverBlock(s: ServerSummary | ServerDetail): string {
  const lines = [`**${s.name}** (\`${s.slug}\`): grade **${s.grade}**`];
  const about = [s.category?.name && `Category: ${s.category.name}`, s.vendor && `Vendor: ${s.vendor}`].filter(Boolean);
  if (about.length) lines.push(about.join(' · '));
  if (s.summary) lines.push(s.summary);
  lines.push('Checks:');
  for (const c of s.checks) lines.push(`- ${c.check}: ${STATE[c.state] ?? c.state}, ${c.note}`);
  lines.push(`Fix first: ${s.fix_first ?? 'nothing; all four checks are at full marks.'}`);
  const facts = [
    `Known CVEs: ${s.known_cves}`,
    s.maintainer_activity && `Upkeep: ${s.maintainer_activity}`,
    s.last_updated && `Last updated: ${s.last_updated}`,
  ].filter(Boolean);
  lines.push(facts.join(' · '));

  if ('transport' in s) {
    if (s.auth_note) lines.push(`Login: ${s.auth_note}`);
    if (s.transport) lines.push(`Transport: ${s.transport}`);
    if (s.alternatives.length) {
      lines.push('Better-graded servers in the same category:');
      for (const a of s.alternatives) lines.push(`- ${a.name} (\`${a.slug}\`): grade ${a.grade}, ${a.url}`);
    }
  }
  lines.push(`Page: ${s.url}`);
  return lines.join('\n');
}

export function serverLine(s: ServerSummary, n?: number): string {
  const prefix = n === undefined ? '-' : `${n}.`;
  const fix = s.fix_first ? ` Fix first: ${s.fix_first}` : ' All four checks at full marks.';
  return `${prefix} **${s.name}** (\`${s.slug}\`): grade **${s.grade}**${s.category ? `, ${s.category.name}` : ''}.${fix} ${s.url}`;
}

export function issuesText(r: RegistrySummary): string {
  if (r.reported_issues === 0) return 'no reported issues';
  const word = r.reported_issues === 1 ? 'issue' : 'issues';
  return `${r.reported_issues} reported ${word}${r.listed_version_affected ? ', listed version affected' : ', listed version not flagged'}`;
}

export function registryLine(r: RegistrySummary): string {
  const graded = r.graded_listing ? ` Graded listing: \`${r.graded_listing.slug}\`, grade ${r.graded_listing.grade}.` : '';
  const status = r.status !== 'active' ? ` Registry status: ${r.status}.` : '';
  return `- \`${r.name}\`${r.title ? ` (${r.title})` : ''}${r.version ? ` v${r.version}` : ''}: ${issuesText(r)}.${status}${graded} ${r.url}`;
}

function advisoryLine(a: Advisory): string {
  const aka = a.also_known_as.length ? ` (also ${a.also_known_as.join(', ')})` : '';
  const sev = a.severity ? `${a.severity}, ` : '';
  const date = a.published_at ? `, published ${a.published_at}` : '';
  return `- ${a.id}${aka}: ${a.title} [${sev}listed version ${a.listed_version}${date}] ${a.url}`;
}

export function registryBlock(r: RegistryDetail): string {
  const lines = [`**${r.title ?? r.name}** (\`${r.name}\`) in the official MCP Registry`];
  if (r.description) lines.push(r.description);
  const facts = [
    r.version && `Listed version: ${r.version}`,
    r.runs_as.length && `Runs as: ${r.runs_as.join(', ')}`,
    `Status: ${r.status}`,
    `Versions tracked: ${r.versions_tracked}`,
  ].filter(Boolean);
  lines.push(facts.join(' · '));
  for (const p of r.packages) if (p.identifier) lines.push(`Package: ${p.type ?? '?'} ${p.identifier}${p.version ? `@${p.version}` : ''}`);
  for (const u of r.remotes) if (u.url) lines.push(`Remote: ${u.url}${u.type ? ` (${u.type})` : ''}`);
  if (r.repo_url) lines.push(`Repo: ${r.repo_url}`);
  lines.push(
    r.graded_listing
      ? `TrustedMCP grade: ${r.graded_listing.grade} (\`${r.graded_listing.slug}\`), ${r.graded_listing.url}`
      : `TrustedMCP grade: none yet. Ask for one: ${REQUEST_REVIEW}`,
  );
  if (r.advisories.length === 0) {
    lines.push(`Reported issues: none found${r.issues_checked_at ? ` (last checked ${r.issues_checked_at.slice(0, 10)})` : ''}.`);
  } else {
    lines.push(`Reported issues (${issuesText(r)}):`);
    for (const a of r.advisories.slice(0, 20)) lines.push(advisoryLine(a));
    if (r.advisories.length > 20) lines.push(`- ...and ${r.advisories.length - 20} more on the page.`);
  }
  lines.push(`Page: ${r.url}`);
  return lines.join('\n');
}
