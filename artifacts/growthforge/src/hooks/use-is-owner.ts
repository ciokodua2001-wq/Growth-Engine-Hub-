import { useCurrentUser } from "./use-current-user";

/**
 * Returns true only when the signed-in user has isOwner = true in the DB.
 * This is completely separate from the admin role — owners have access to
 * Owner's Corner features above and beyond super_admin.
 */
export function useIsOwner(): boolean {
  const { data } = useCurrentUser();
  return data?.isOwner ?? false;
}
