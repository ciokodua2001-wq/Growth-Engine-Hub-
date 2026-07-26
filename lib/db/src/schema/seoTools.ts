import { pgTable, text, serial, timestamp, integer, jsonb, date } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/* ── SEO Blog Posts ─────────────────────────────────────────────────────── */

export const seoBlogPostsTable = pgTable("seo_blog_posts", {
  id:              serial("id").primaryKey(),
  projectId:       integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  keyword:         text("keyword").notNull(),
  title:           text("title").notNull(),
  content:         text("content").notNull(),       // full HTML/markdown article
  metaTitle:       text("meta_title"),
  metaDescription: text("meta_description"),
  wordCount:       integer("word_count").default(0),
  status:          text("status").notNull().default("complete"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoBlogPost = typeof seoBlogPostsTable.$inferSelect;

/* ── SEO Meta Tags ──────────────────────────────────────────────────────── */

export const seoMetaTagsTable = pgTable("seo_meta_tags", {
  id:          serial("id").primaryKey(),
  projectId:   integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  pages:       jsonb("pages").notNull(),             // MetaTagPage[]
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoMetaTags = typeof seoMetaTagsTable.$inferSelect;

/* ── SEO Schema Markup ──────────────────────────────────────────────────── */

export const seoSchemaMarkupTable = pgTable("seo_schema_markup", {
  id:          serial("id").primaryKey(),
  projectId:   integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  schemas:     jsonb("schemas").notNull(),            // SchemaBlock[]
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoSchemaMarkup = typeof seoSchemaMarkupTable.$inferSelect;

/* ── SEO Sitemap ────────────────────────────────────────────────────────── */

export const seoSitemapTable = pgTable("seo_sitemaps", {
  id:        serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  xml:       text("xml").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoSitemap = typeof seoSitemapTable.$inferSelect;

/* ── SEO Watchdog ───────────────────────────────────────────────────────── */

export const seoWatchdogTable = pgTable("seo_watchdog", {
  id:          serial("id").primaryKey(),
  projectId:   integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  weekOf:      date("week_of", { mode: "string" }).notNull(),
  headline:    text("headline").notNull(),
  summary:     text("summary").notNull(),
  actions:     jsonb("actions").notNull(),            // WatchdogAction[]
  progressNote: text("progress_note"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoWatchdog = typeof seoWatchdogTable.$inferSelect;
