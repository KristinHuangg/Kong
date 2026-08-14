/**
 * Identity attached to a request once the auth guard has run.
 *
 * organizationId is the tenant boundary: every repository query in this API is
 * filtered by it, and it comes from the token rather than from user input so a
 * caller cannot ask for another organization's data.
 */
export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  email?: string;
}
