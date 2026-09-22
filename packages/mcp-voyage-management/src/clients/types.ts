/**
 * The end user this tool call acts on behalf of — sent by Voyage Agent as
 * the `actor` argument on every tool call (Voyage-Agent's own
 * `tools/mcp-client.service.ts`), never derived here. Forwarded unchanged
 * as `x-user-id`/`x-user-email`/`x-user-role`/`x-company-name` on every
 * downstream call this package makes — Voyage Management Service's and
 * Reports Agent's own `@Actor()` decorators require all but `role`.
 */
export interface Actor {
  userId: string;
  email: string;
  role: string;
  companyName: string;
}

export interface VpmVessel {
  id: number;
  name: string;
}

export interface ClientShip {
  id: number;
  name: string;
  mappingname: string | null;
}
