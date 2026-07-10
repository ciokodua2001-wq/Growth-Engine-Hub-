import PDFDocument from '/tmp/pdfgen/node_modules/pdfkit/js/pdfkit.standalone.js';
import { createWriteStream } from 'fs';

const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
const out = '/home/runner/workspace/GrowthForge_GoogleAds_Design.pdf';
doc.pipe(createWriteStream(out));

const h2 = (t) => {
  doc.moveDown(0.4).fontSize(13).font('Helvetica-Bold').fillColor('#111').text(t).moveDown(0.15);
  doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#bbbbbb').stroke().moveDown(0.3);
};
const p  = (t) => doc.fontSize(11).font('Helvetica').fillColor('#222').text(t, { lineGap: 3 }).moveDown(0.4);
const li = (t) => doc.fontSize(11).font('Helvetica').fillColor('#222').text('  \u2022  ' + t, { lineGap: 3 });

// Title
doc.fontSize(20).font('Helvetica-Bold').fillColor('#111')
  .text('GrowthForge AI', { continued: true })
  .font('Helvetica').text(' \u2013 Google Ads API Design Documentation');
doc.fontSize(10).font('Helvetica').fillColor('#666')
  .text('Company: Strapli Technologies Inc.  |  Product: GrowthForge AI (usegrowthforge.com)  |  July 2026')
  .moveDown(1);

h2('1. Tool Overview');
p('GrowthForge AI is an AI-powered marketing SaaS platform that serves as a complete AI marketing department for small and medium-sized businesses. Users connect their Google Ads account to the platform via OAuth 2.0 to import real campaign performance data, view AI-generated optimization recommendations, and monitor all campaigns in one unified dashboard.');

h2('2. Google Ads API Feature: Campaign Manager');
doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('Feature name: ', { continued: true })
  .font('Helvetica').text('Campaign Manager \u2013 Google Ads Sync').moveDown(0.2);
doc.fontSize(11).font('Helvetica-Bold').text('Location: ', { continued: true })
  .font('Helvetica').text('Project Dashboard > Campaign Manager').moveDown(0.4);
doc.fontSize(11).font('Helvetica-Bold').text('User flow:').moveDown(0.2);
[
  'User navigates to Campaign Manager inside their GrowthForge project.',
  'A "Connect Google Ads" panel is displayed at the top of the page.',
  'User clicks "Connect Google Ads" -- initiates OAuth 2.0 consent flow (scope: adwords).',
  'User grants permission on Google OAuth consent screen.',
  'Platform stores the refresh token server-side; user is redirected back to Campaign Manager.',
  'User sees connected account info (email, customer ID, last sync time).',
  'User clicks "Sync Now" -- platform fetches latest campaign data via GAQL query (last 30 days).',
  'Campaigns appear with real metrics: impressions, clicks, conversions, spend, CTR, CPC, ROAS.',
  'Synced campaigns are visually badged as "Google Ads" for clear attribution.',
].forEach(li);
doc.moveDown(0.5);

h2('3. Campaign Types Supported');
p('Search, Display, Video, Performance Max\n\nCampaign type is read from campaign.advertising_channel_type in the API response and displayed alongside each campaign row in the dashboard.');

h2('4. Google Ads Capabilities Provided');
doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('Campaign Management: ', { continued: true })
  .font('Helvetica').text('Users can view, monitor, and track all active Google Ads campaigns from within GrowthForge.').moveDown(0.4);
doc.fontSize(11).font('Helvetica-Bold').text('Reporting: ', { continued: true })
  .font('Helvetica').text('Platform surfaces 30-day performance summaries (impressions, clicks, conversions, spend, ROAS, CTR, CPC) and AI-generated optimization recommendations based on live campaign data.').moveDown(0.5);

h2('5. GAQL Query Used');
doc.fontSize(9).font('Courier').fillColor('#333').text(
  'SELECT campaign.id, campaign.name, campaign.status,\n' +
  '  campaign.advertising_channel_type,\n' +
  '  metrics.impressions, metrics.clicks, metrics.conversions,\n' +
  '  metrics.cost_micros, metrics.ctr, metrics.average_cpc\n' +
  'FROM campaign\n' +
  'WHERE segments.date DURING LAST_30_DAYS\n' +
  '  AND campaign.status != \'REMOVED\'\n' +
  'ORDER BY metrics.impressions DESC LIMIT 50'
).moveDown(0.6);

h2('6. OAuth & API Access Details');
[
  'OAuth scope: https://www.googleapis.com/auth/adwords',
  'Auth type: OAuth 2.0 with offline access (refresh token)',
  'Redirect URI: https://usegrowthforge.com/api/auth/google-ads/callback',
  'API version: Google Ads API v18',
  'login-customer-id header used for manager account (MCC) flows',
].forEach(li);
doc.moveDown(0.5);

h2('7. Data Storage & Security');
[
  'OAuth tokens stored server-side in PostgreSQL -- never exposed to the browser.',
  'Access tokens refreshed automatically on expiry using the stored refresh token.',
  'Campaign data cached in platform database and refreshed on user request ("Sync Now").',
  'Users can disconnect at any time -- tokens immediately deleted, synced campaigns reverted.',
  'All API communication is server-to-server; the developer token is never sent to the client.',
].forEach(li);
doc.moveDown(0.5);

h2('8. Who Has Access');
p('External users -- GrowthForge customers access this feature through their own authenticated GrowthForge account. Each user connects their own Google Ads account via OAuth. The platform never accesses any Google Ads account without explicit authorization from the account owner.');

h2('9. Target Audience');
[
  'Small and medium-sized businesses running Google Ads who want a unified AI marketing dashboard.',
  'Marketing agencies managing Google Ads on behalf of multiple clients.',
].forEach(li);
doc.moveDown(0.5);

h2('10. App Conversion Tracking & Remarketing API');
p('Not used. GrowthForge does not use the App Conversion Tracking or Remarketing API. Our use is limited to reading campaign performance data via GAQL queries for reporting and campaign management purposes only.');

doc.end();
console.log('PDF written to: ' + out);
