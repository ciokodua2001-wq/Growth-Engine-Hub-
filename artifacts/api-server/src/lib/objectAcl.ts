import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { objectAclPoliciesTable } from "@workspace/db";

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export type ObjectAccessGroupType = string;

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

/**
 * Identifies an object in Supabase Storage. Replaces the GCS `File` handle
 * previously passed around here — Supabase Storage has no first-class custom
 * metadata API, so ACL state is tracked in Postgres (see schema/objectStorage.ts)
 * instead of on the storage object itself.
 */
export interface StorageObjectRef {
  bucketName: string;
  objectName: string;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement per access group type, e.g.:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  ref: StorageObjectRef,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  await db
    .insert(objectAclPoliciesTable)
    .values({
      bucketName: ref.bucketName,
      objectName: ref.objectName,
      ownerId: aclPolicy.owner,
      visibility: aclPolicy.visibility,
      aclRules: aclPolicy.aclRules ?? [],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [objectAclPoliciesTable.bucketName, objectAclPoliciesTable.objectName],
      set: {
        ownerId: aclPolicy.owner,
        visibility: aclPolicy.visibility,
        aclRules: aclPolicy.aclRules ?? [],
        updatedAt: new Date(),
      },
    });
}

export async function getObjectAclPolicy(
  ref: StorageObjectRef,
): Promise<ObjectAclPolicy | null> {
  const [row] = await db
    .select()
    .from(objectAclPoliciesTable)
    .where(
      and(
        eq(objectAclPoliciesTable.bucketName, ref.bucketName),
        eq(objectAclPoliciesTable.objectName, ref.objectName),
      ),
    );
  if (!row) return null;
  return {
    owner: row.ownerId,
    visibility: row.visibility as "public" | "private",
    aclRules: (row.aclRules ?? undefined) as ObjectAclPolicy["aclRules"],
  };
}

export async function canAccessObject({
  userId,
  objectRef,
  requestedPermission,
}: {
  userId?: string;
  objectRef: StorageObjectRef;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectRef);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
