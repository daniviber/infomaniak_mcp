/**
 * Every route this client calls exists in Infomaniak's published OpenAPI
 * document, with the method it is called with.
 *
 * The document is https://developer.infomaniak.com/openapi.json (OpenAPI 3.1,
 * 1 088 paths). src/__fixtures__/infomaniak-openapi-paths.json keeps
 * path -> methods for the families this server uses, recorded on the date in
 * its `_recorded` block; nothing in it was renamed or edited.
 *
 * A route missing here may still exist as an undocumented legacy endpoint.
 * One that is documented under another path — as the whole `/1/mail/...`
 * family is, under `/1/mail_hostings/{id}/mailboxes/{name}/...` — is a route
 * this server gets wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '__fixtures__', 'infomaniak-openapi-paths.json'), 'utf8')) as {
  _recorded: { source: string; date: string };
  paths: Record<string, string[]>;
};
const clientSource = readFileSync(join(here, 'infomaniak-client.ts'), 'utf8').replace(/\r\n/g, '\n');

interface Call {
  method: string;
  template: string;
  fn: string;
}

/** Every `this.request<...>('METHOD', `path`)` in the client, with its enclosing method name. */
function clientCalls(): Call[] {
  const calls: Call[] = [];
  const fnRe = /async (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(clientSource))) {
    const end = clientSource.indexOf('\n  }\n', m.index);
    const body = clientSource.slice(m.index, end < 0 ? undefined : end);
    const reqRe = /this\.request<[^(]*>\(\s*'(\w+)',\s*(`[^`]*`|path)/g;
    let r: RegExpExecArray | null;
    while ((r = reqRe.exec(body))) {
      const templates =
        r[2] === 'path' ? [...body.matchAll(/`([^`]*)`/g)].map((t) => t[1]) : [r[2].slice(1, -1)];
      for (const template of templates) calls.push({ method: r[1], template, fn: m[1] });
    }
  }
  return calls;
}

function documentedPathsMatching(template: string): string[] {
  const concrete = template.replace(/\$\{[^}]+\}/g, 'X');
  return Object.keys(fixture.paths).filter((p) =>
    new RegExp('^' + p.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(concrete),
  );
}


/**
 * Routes this client calls that the published document does not have, as of
 * the recording date. They may be legacy endpoints that still answer, or
 * endpoints that moved (domains are under /2/domains, products under
 * /1/accounts/{id}/products, Swiss Backup under /1/swiss_backups, parts of
 * kDrive under /3/drive). Each is a known gap, not a verified route: it is
 * listed here so that the suite stays green on what is known and goes red the
 * day a listed route becomes documented — that is the moment to verify it and
 * take it off the list. The mail routes were in this list until 2026-10-10,
 * when they were rewritten on the documented ones and checked live.
 */
export const UNDOCUMENTED_ROUTES: ReadonlySet<string> = new Set([
  "DELETE /1/domain/${domain}/dns/record/${recordId}",
  "DELETE /1/web/${hostingId}/cron/${cronId}",
  "DELETE /1/web/${hostingId}/database/${dbId}",
  "DELETE /1/web/${hostingId}/ftp/${ftpId}",
  "DELETE /1/web/${hostingId}/site/${siteId}",
  "GET /1/account/${accountId}",
  "GET /1/account/${accountId}/product",
  "GET /1/certificate",
  "GET /1/certificate/${certId}",
  "GET /1/dedicated",
  "GET /1/dedicated/${serverId}",
  "GET /1/domain/${domain}/dns/record",
  "GET /1/domain/${domain}/nameserver",
  "GET /1/domain/account/${accountId}",
  "GET /1/domain/account/${accountId}/domain/${domain}",
  "GET /1/invoicing/${accountId}/invoice/${invoiceId}",
  "GET /1/invoicing/${accountId}/invoice/list",
  "GET /1/swiss_backup",
  "GET /1/swiss_backup/${backupId}",
  "GET /1/swiss_backup/${backupId}/slot",
  "GET /1/vps",
  "GET /1/vps/${vpsId}",
  "GET /1/web",
  "GET /1/web/${hostingId}",
  "GET /1/web/${hostingId}/cron",
  "GET /1/web/${hostingId}/database",
  "GET /1/web/${hostingId}/database/${dbId}",
  "GET /1/web/${hostingId}/ftp",
  "GET /1/web/${hostingId}/site",
  "GET /1/web/${hostingId}/site/${siteId}",
  "GET /2/drive/${driveId}/activity",
  "GET /2/drive/${driveId}/files",
  "GET /2/drive/${driveId}/files/${fileId}",
  "GET /2/drive/${driveId}/files/${fileId}/activity",
  "GET /2/drive/${driveId}/files/${parentId}/files",
  "GET /2/drive/${driveId}/files/favorites",
  "GET /2/drive/${driveId}/files/search",
  "GET /2/drive/${driveId}/files/trash",
  "POST /1/dedicated/${serverId}/reboot",
  "POST /1/domain/${domain}/dns/record",
  "POST /1/domain/${domain}/renew",
  "POST /1/vps/${vpsId}/boot",
  "POST /1/vps/${vpsId}/reboot",
  "POST /1/vps/${vpsId}/shutdown",
  "POST /1/web/${hostingId}/cron",
  "POST /1/web/${hostingId}/database",
  "POST /1/web/${hostingId}/ftp",
  "POST /1/web/${hostingId}/site",
  "POST /2/drive/${driveId}/files/${fileId}/copy",
  "POST /2/drive/${driveId}/files/${fileId}/move",
  "POST /2/drive/${driveId}/files/${fileId}/shareable_link",
  "POST /2/drive/${driveId}/files/directories",
  "POST /2/drive/${driveId}/files/trash/${fileId}/restore",
  "PUT /1/domain/${domain}/dns/record/${recordId}",
  "PUT /1/domain/${domain}/nameserver",
  "PUT /1/web/${hostingId}/cron/${cronId}",
  "PUT /1/web/${hostingId}/ftp/${ftpId}",
  "PUT /1/web/${hostingId}/site/${siteId}",
]);

const calls = clientCalls();

describe(`the routes the client calls, against the OpenAPI document of ${fixture._recorded.date.slice(0, 10)}`, () => {
  it('finds the client calls to check', () => {
    expect(calls.length).toBeGreaterThan(70);
  });

  for (const call of calls) {
    const key = `${call.method} ${call.template}`;
    const check = UNDOCUMENTED_ROUTES.has(key) ? it.fails : it;
    check(`${call.method} ${call.template}  (${call.fn})`, () => {
      const paths = documentedPathsMatching(call.template);
      expect(paths, `no documented path matches ${call.template}`).not.toHaveLength(0);
      const withMethod = paths.filter((p) => fixture.paths[p].includes(call.method));
      expect(
        withMethod,
        `${paths[0]} is documented for ${(fixture.paths[paths[0]] ?? []).join(',')}, not ${call.method}`,
      ).not.toHaveLength(0);
    });
  }

  it("every route listed as undocumented is still called, and still undocumented", () => {
    const called = new Set(calls.map((c) => `${c.method} ${c.template}`));
    for (const key of UNDOCUMENTED_ROUTES) {
      expect(called.has(key), `${key} is listed as a known gap but the client no longer calls it`).toBe(true);
      const [method, template] = key.split(" ", 2);
      const documented = documentedPathsMatching(template).some((p) => fixture.paths[p].includes(method));
      expect(documented, `${key} is documented now — verify it and take it off the list`).toBe(false);
    }
  });
});
