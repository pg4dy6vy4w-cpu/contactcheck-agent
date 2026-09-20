import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const intent = String(input.intent || 'sales').toLowerCase();
const maxPages = Math.max(1, Math.min(Number(input.maxPages || 8), 20));

function normalizeSite(value) {
  if (!value || typeof value !== 'string') throw new Error('Input "domain" is required.');
  let v = value.trim();
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  const u = new URL(v);
  u.hash = '';
  return u;
}

const start = normalizeSite(input.domain);
const root = new URL('/', start);
const domain = root.hostname.replace(/^www\./i, '');

const INTENT_WORDS = {
  sales: ['sales','demo','pricing','business','commercial','buy','quote','enquiry','inquiry'],
  partnership: ['partner','partnership','alliances','business development','collaborate'],
  support: ['support','help','customer service','contact','service'],
  press: ['press','media','newsroom','pr','communications'],
  careers: ['careers','jobs','recruit','hiring','people','talent'],
  general: ['contact','hello','info','general']
};

const ROLE_HINTS = {
  sales: ['sales','commercial','business','bizdev','bd','growth','hello','info','contact'],
  partnership: ['partner','partnership','alliances','business','bizdev','bd','hello','info'],
  support: ['support','help','service','care','success','hello','info'],
  press: ['press','media','pr','communications','comms','news'],
  careers: ['careers','jobs','recruit','recruitment','talent','people','hr'],
  general: ['hello','info','contact','office','enquiries','inquiries']
};

const BAD_LOCAL = ['noreply','no-reply','donotreply','do-not-reply','privacy','legal','abuse','security'];
const GENERIC_PATHS = ['/contact','/contact-us','/about','/about-us','/team'];
const INTENT_PATHS = {
  sales: ['/sales','/demo','/pricing'],
  partnership: ['/partners','/partnerships'],
  support: ['/support','/help'],
  press: ['/press','/media','/newsroom'],
  careers: ['/careers','/jobs'],
  general: []
};

function cleanEmail(s) {
  return s.replace(/^mailto:/i,'').split('?')[0].trim().replace(/[),.;:]+$/,'').toLowerCase();
}
function cleanPhone(s) {
  return s.replace(/^tel:/i,'').split('?')[0].trim().replace(/\s+/g,' ');
}
function sameHost(url) {
  return url.hostname.replace(/^www\./i,'') === domain;
}
function addUnique(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
}
function pageRelevance(url, text='') {
  const hay = (url.pathname + ' ' + text).toLowerCase();
  let score = /contact/.test(hay) ? 8 : 0;
  for (const w of INTENT_WORDS[intent] || []) if (hay.includes(w)) score += 4;
  return score;
}
function scoreEmail(email, sourceUrl, context='') {
  const local = email.split('@')[0] || '';
  const emailDomain = email.split('@')[1] || '';
  let score = 50;
  const reasons = ['publicly listed on company website'];
  if (emailDomain === domain || emailDomain.endsWith('.' + domain)) { score += 18; reasons.push('matches company domain'); }
  const hints = ROLE_HINTS[intent] || [];
  if (hints.some(h => local.includes(h))) { score += 20; reasons.push('mailbox matches requested intent'); }
  if ((INTENT_WORDS[intent] || []).some(w => context.toLowerCase().includes(w))) { score += 8; reasons.push('page context matches requested intent'); }
  if (BAD_LOCAL.some(w => local.includes(w))) { score -= 45; reasons.push('mailbox appears unsuitable for outreach'); }
  return { score: Math.max(0, Math.min(score, 99)), reasons };
}
function scoreForm(url, context='') {
  let score = 52 + pageRelevance(url, context);
  return { score: Math.min(score, 92), reasons: ['public contact form', ...(pageRelevance(url, context) > 8 ? ['page matches requested intent'] : [])] };
}
function scorePhone(sourceUrl, context='') {
  let score = 48 + Math.min(pageRelevance(sourceUrl, context), 18);
  return { score: Math.min(score, 85), reasons: ['publicly listed business phone'] };
}
function scoreRoute(url, label='', context='') {
  const hay = (label + ' ' + url.pathname + ' ' + context).toLowerCase();
  const words = INTENT_WORDS[intent] || [];
  const matched = words.filter(w => hay.includes(w));
  if (!matched.length) return null;

  let score = 68;
  const reasons = ['official public contact route'];
  const labelLower = label.toLowerCase();
  if (words.some(w => labelLower.includes(w))) {
    score += 18;
    reasons.push('link or button explicitly matches requested intent');
  }
  if (/contact|talk|speak|request|book|demo|quote|enquir|inquir|get started|start now/.test(labelLower)) {
    score += 8;
    reasons.push('clear contact call to action');
  }
  if (/contact|sales|demo|partner|support|help|press|media|career|job|quote|enquir|inquir/.test(url.pathname.toLowerCase())) {
    score += 5;
    reasons.push('destination appears contact-related');
  }
  return { score: Math.min(score, 98), reasons };
}

const emails = new Map();
const phones = new Map();
const forms = new Map();
const routes = new Map();
const socials = new Map();
const pagesChecked = [];
const discovered = new Map();

for (const p of [...GENERIC_PATHS, ...(INTENT_PATHS[intent] || [])]) {
  const u = new URL(p, root);
  discovered.set(u.href, 100 + pageRelevance(u));
}
discovered.set(root.href, 200);

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ContactCheck/0.1; +https://apify.com/)' }
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('text/html')) return null;
    return { html: await res.text(), finalUrl: new URL(res.url) };
  } catch (e) {
    log.debug('Page fetch failed', { url: url.href, error: e.message });
    return null;
  } finally { clearTimeout(timer); }
}

const visited = new Set();
while (visited.size < maxPages) {
  const next = [...discovered.entries()]
    .filter(([href]) => !visited.has(href))
    .sort((a,b) => b[1]-a[1])[0];
  if (!next) break;

  const requested = new URL(next[0]);
  visited.add(requested.href);
  const page = await fetchPage(requested);
  if (!page || !sameHost(page.finalUrl)) continue;

  pagesChecked.push(page.finalUrl.href);
  const $ = cheerio.load(page.html);
  $('script,style,noscript,svg').remove();
  const text = $('body').text().replace(/\s+/g,' ').slice(0,100000);

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const match of text.match(emailRegex) || []) {
    const email = cleanEmail(match);
    if (!email || /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) continue;
    const s = scoreEmail(email, page.finalUrl, text);
    const prev = emails.get(email);
    if (!prev || s.score > prev.score) emails.set(email, { value: email, type: 'email', confidence: s.score / 100, sourceUrl: page.finalUrl.href, reasons: s.reasons });
  }

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    const label = $(el).text().replace(/\s+/g,' ').trim();
    if (/^mailto:/i.test(href)) {
      const email = cleanEmail(href);
      if (email) {
        const s = scoreEmail(email, page.finalUrl, label + ' ' + text.slice(0,5000));
        const prev = emails.get(email);
        if (!prev || s.score > prev.score) emails.set(email, { value: email, type: 'email', confidence: s.score / 100, sourceUrl: page.finalUrl.href, reasons: s.reasons });
      }
      return;
    }
    if (/^tel:/i.test(href)) {
      const phone = cleanPhone(href);
      if (phone) {
        const s = scorePhone(page.finalUrl, label);
        addUnique(phones, phone, { value: phone, type: 'phone', confidence: s.score / 100, sourceUrl: page.finalUrl.href, reasons: s.reasons });
      }
      return;
    }
    try {
      const u = new URL(href, page.finalUrl);
      if (/linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com/i.test(u.hostname)) {
        addUnique(socials, u.href, { url: u.href, sourceUrl: page.finalUrl.href });
      } else if (['http:','https:'].includes(u.protocol)) {
        u.hash = '';
        const routeScore = scoreRoute(u, label);
        if (routeScore && !/privacy|legal|terms|cookie|login|sign[- ]?in/i.test(label + ' ' + u.pathname)) {
          const key = u.href;
          const candidate = {
            value: u.href,
            type: intent === 'sales' ? 'sales_route' : 'contact_route',
            confidence: routeScore.score / 100,
            sourceUrl: page.finalUrl.href,
            label: label || null,
            reasons: routeScore.reasons
          };
          const prev = routes.get(key);
          if (!prev || candidate.confidence > prev.confidence) routes.set(key, candidate);
        }
        if (sameHost(u)) {
          const rel = pageRelevance(u, label);
          if (rel > 0 && !discovered.has(u.href)) discovered.set(u.href, rel);
        }
      }
    } catch {}
  });

  $('form').each((_, el) => {
    const formText = $(el).text().replace(/\s+/g,' ').trim();
    const fields = $(el).find('input, textarea, select');
    const hasUserField = fields.toArray().some(field => {
      const node = $(field);
      const hay = [
        node.attr('name') || '',
        node.attr('id') || '',
        node.attr('placeholder') || '',
        node.attr('type') || ''
      ].join(' ').toLowerCase();
      return /(email|name|message|phone|company|subject|enquir|inquir)/.test(hay);
    });
    const formHay = formText.toLowerCase();
    const hasContactLanguage = /(contact|sales|demo|message|enquir|inquir|support|partner|press|media|career|job|talk to|speak to)/.test(formHay);
    if (!hasUserField && !hasContactLanguage) return;

    const action = ($(el).attr('action') || '').trim();
    let submissionUrl = page.finalUrl;
    try {
      if (action && action !== '#' && !/^javascript:/i.test(action)) {
        const candidate = new URL(action, page.finalUrl);
        if (sameHost(candidate)) submissionUrl = candidate;
      }
      const s = scoreForm(page.finalUrl, formText);
      addUnique(forms, page.finalUrl.href, {
        value: page.finalUrl.href,
        type: 'form',
        confidence: s.score / 100,
        sourceUrl: page.finalUrl.href,
        submissionUrl: submissionUrl.href,
        reasons: s.reasons
      });
    } catch {}
  });
}

const candidates = [...routes.values(), ...emails.values(), ...phones.values(), ...forms.values()]
  .sort((a,b) => b.confidence - a.confidence);
const bestContact = candidates[0] || null;

const result = {
  domain,
  intent,
  contactable: Boolean(bestContact),
  bestContact,
  emails: [...emails.values()].sort((a,b) => b.confidence-a.confidence),
  phones: [...phones.values()].sort((a,b) => b.confidence-a.confidence),
  contactRoutes: [...routes.values()].sort((a,b) => b.confidence-a.confidence),
  contactForms: [...forms.values()].sort((a,b) => b.confidence-a.confidence),
  socialProfiles: [...socials.values()],
  pagesChecked,
  checkedAt: new Date().toISOString()
};

await Actor.pushData(result);
await Actor.setValue('OUTPUT', result);
log.info('ContactCheck complete', { domain, intent, contactable: result.contactable, pagesChecked: pagesChecked.length });
await Actor.exit();
