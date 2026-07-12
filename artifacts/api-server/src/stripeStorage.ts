import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";

export class StripeStorage {
  async getUser(id: string) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    return user ?? null;
  }

  async updateUserStripeInfo(
    userId: string,
    info: {
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      plan?: string;
      subscriptionStatus?: string;
      cancelledAt?: Date;
    },
  ) {
    const [user] = await db
      .update(usersTable)
      .set(info)
      .where(eq(usersTable.id, userId))
      .returning();
    return user;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId} LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  async listProductsWithPrices() {
    const result = await db.execute(sql`
      WITH active_products AS (
        SELECT id, name, description, metadata, active
        FROM stripe.products
        WHERE active = true
        ORDER BY name
      )
      SELECT
        p.id           AS product_id,
        p.name         AS product_name,
        p.description  AS product_description,
        p.active       AS product_active,
        p.metadata     AS product_metadata,
        pr.id          AS price_id,
        pr.unit_amount,
        pr.currency,
        pr.recurring,
        pr.active      AS price_active
      FROM active_products p
      LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      ORDER BY pr.unit_amount ASC NULLS LAST
    `);
    return result.rows;
  }
}

export const stripeStorage = new StripeStorage();
