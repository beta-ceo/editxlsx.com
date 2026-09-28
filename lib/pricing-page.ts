/**
 * /pricing -- dedicated cloud storage tiers + Stripe Checkout / Customer Portal.
 * Dollar amounts live here (and in lib/billing/plans.ts), not on the home hero.
 */
import 'ranui/button';
import 'ranui/message';
import { Div, View } from 'ranui/builder';
import '../styles/pricing.css';
import { applyDocumentLanguage, getLanguage, localeHomePath, withLocale } from '@ranuts/shared/i18n';
import { getCurrentUser } from './appwrite/auth';
import { isBillingConfigured, startCheckout, startCustomerPortal } from './billing/client';
import { entitlementFromUser } from './billing/entitlement';
import { CLOUD_PLAN_LIST, formatPlanQuota, type CloudPlan, type CloudPlanId } from './billing/plans';

const FEATURED_PLAN: CloudPlanId = 'gb10';

function notifyError(message: string): void {
  const api = (window as unknown as { message?: { error?: (msg: string) => void } }).message;
  api?.error?.(message);
}

function loginUrl(): string {
  return withLocale(`/login?next=${encodeURIComponent('/pricing')}`, getLanguage());
}

function button(label: string, onClick: () => void, options: { type?: string; id?: string } = {}): HTMLElement {
  const builder = View('r-button').text(label).on('click', onClick);
  if (options.id) builder.id(options.id);
  if (options.type) builder.attr('type', options.type);
  return builder.build();
}

function planBlurb(plan: CloudPlan): string {
  if (plan.id === 'gb1') return 'Same workbook on phone, laptop, and work PC.';
  return '10× the room of 1 GB for only twice the price.';
}

function planFeatures(plan: CloudPlan): string[] {
  const shared = [
    'Open and autosave from any signed-in device',
    'This-device library stays free forever',
    'Cancel or change anytime via Stripe',
  ];
  if (plan.id === 'gb1') {
    return [`${formatPlanQuota(plan)} account storage`, 'Enough for dozens of typical workbooks', ...shared];
  }
  return [`${formatPlanQuota(plan)} account storage`, 'Day-to-day library across devices', ...shared];
}

function planValueHint(plan: CloudPlan): string | null {
  if (plan.id === 'gb1') return 'Starter · light cross-device';
  return 'Recommended · best value';
}

async function checkout(planId: CloudPlanId, signedIn: boolean): Promise<void> {
  if (!signedIn) {
    window.location.assign(loginUrl());
    return;
  }
  if (!isBillingConfigured()) {
    notifyError('Billing is not configured in this environment.');
    return;
  }
  try {
    const origin = window.location.origin;
    const success = withLocale(`${origin}/workspace?source=cloud&checkout=1`, getLanguage());
    const cancel = withLocale(`${origin}/pricing`, getLanguage());
    await startCheckout(planId, success, cancel);
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error));
  }
}

function priceEl(amount: string, unit: string): HTMLElement {
  const el = View('p').class('pricing-card-price').build();
  el.append(document.createTextNode(amount), View('small').text(unit).build());
  return el;
}

applyDocumentLanguage();

void (async () => {
  const user = await getCurrentUser();
  const entitlement = entitlementFromUser(user);
  const root = document.getElementById('pricing-root');
  if (!root) return;
  root.removeAttribute('aria-busy');

  const title = View('h1').class('pricing-title').build();
  title.append(
    document.createTextNode('Simple pricing for '),
    View('span').class('accent').text('optional cloud').build(),
  );

  const hero = Div()
    .class('pricing-hero pricing-reveal d1')
    .children(
      View('span').class('pricing-badge').text('Local free · Cloud optional').build(),
      title,
      View('p')
        .class('pricing-lead')
        .text(
          'Editing in this browser stays free. Pay yearly only when the same workbook needs to follow your account across devices.',
        )
        .build(),
      View('ul')
        .class('pricing-checks')
        .children(
          View('li').text('No Office install').build(),
          View('li').text('Local library forever free').build(),
          View('li').text('Cloud when you need it').build(),
        )
        .build(),
    )
    .build();

  const freeCard = Div()
    .class('pricing-card is-free pricing-reveal d3')
    .attr('data-plan', 'local')
    .children(
      View('p').class('pricing-card-eyebrow').text('Always included').build(),
      View('h3').class('pricing-card-title').text('This device').build(),
      priceEl('$0', '/ forever'),
      View('p').class('pricing-card-value').text('Included · no account').build(),
      View('p')
        .class('pricing-card-blurb')
        .text('Edit and save in this browser. Cloud is only for cross-device.')
        .build(),
      View('ul')
        .class('pricing-card-list')
        .children(
          View('li').text('Upload, edit, and save locally').build(),
          View('li').text('Works offline after assets cache').build(),
          View('li').text('7-day AutoRecover for crashes').build(),
          View('li').text('No account or yearly fee').build(),
        )
        .build(),
      Div()
        .class('pricing-card-cta')
        .children(
          button(
            'Open This device',
            () => {
              window.location.assign(withLocale('/workspace', getLanguage()));
            },
            { type: 'primary', id: 'pricing-local' },
          ),
        )
        .build(),
    )
    .build();

  const paidCards = CLOUD_PLAN_LIST.map((plan, index) => {
    const featured = plan.id === FEATURED_PLAN;
    const current = entitlement.planId === plan.id;
    const children: HTMLElement[] = [];
    if (featured) {
      children.push(View('span').class('pricing-card-ribbon').text('Popular').build());
    }
    children.push(
      View('p').class('pricing-card-eyebrow').text('Cloud · cross-device').build(),
      View('h3').class('pricing-card-title').text(formatPlanQuota(plan)).build(),
      priceEl(`$${plan.dollarsPerYear}`, '/ year'),
      View('p').class('pricing-card-value').text(planValueHint(plan) ?? '').build(),
      View('p').class('pricing-card-blurb').text(planBlurb(plan)).build(),
      View('ul')
        .class('pricing-card-list')
        .children(...planFeatures(plan).map((item) => View('li').text(item).build()))
        .build(),
      Div()
        .class('pricing-card-cta')
        .children(
          button(
            current
              ? 'Current plan'
              : user
                ? `Choose ${formatPlanQuota(plan)}`
                : plan.id === FEATURED_PLAN
                  ? `Get ${formatPlanQuota(plan)} · best value`
                  : `Get ${formatPlanQuota(plan)}`,
            () => {
              void checkout(plan.id, Boolean(user));
            },
            {
              type: current ? 'text' : featured ? 'primary' : undefined,
              id: `pricing-plan-${plan.id}`,
            },
          ),
        )
        .build(),
    );

    return Div()
      .class(
        `pricing-card pricing-reveal d${Math.min(3 + index, 5)}${featured ? ' is-featured' : ''}${current ? ' is-current' : ''}`,
      )
      .attr('data-plan', plan.id)
      .children(...children)
      .build();
  });

  const plans = Div()
    .class('pricing-section')
    .children(
      Div()
        .class('pricing-section-head pricing-reveal d3')
        .children(
          View('h2').text('Plans').build(),
          View('p')
            .text(
              'Editing stays free on This device. Pay only when the same file must follow your account across devices — pick a quota that matches how many workbooks you keep in the cloud.',
            )
            .build(),
        )
        .build(),
      Div().class('pricing-grid').children(freeCard, ...paidCards).build(),
    )
    .build();

  const actions = Div().class('pricing-actions pricing-reveal d4').build();
  if (user && entitlement.stripeCustomerId) {
    actions.append(
      button(
        'Manage billing',
        () => {
          void (async () => {
            try {
              await startCustomerPortal(withLocale(`${window.location.origin}/pricing`, getLanguage()));
            } catch (error) {
              notifyError(error instanceof Error ? error.message : String(error));
            }
          })();
        },
        { type: 'text', id: 'pricing-portal' },
      ),
    );
  }
  if (!user) {
    actions.append(
      View('a').class('pricing-link').attr('href', loginUrl()).text('Already have an account? Sign in').build(),
    );
  }
  actions.append(
    View('a')
      .class('pricing-link')
      .attr('href', withLocale('/workspace', getLanguage()))
      .text('Workspace')
      .build(),
    View('a').class('pricing-link').attr('href', localeHomePath(getLanguage())).text('Home').build(),
  );

  const compare = Div()
    .class('pricing-section pricing-reveal d4')
    .children(
      Div()
        .class('pricing-section-head')
        .children(
          View('h2').text('When free is enough — and when it is not').build(),
          View('p')
            .text(
              'Most people only need This device. Cloud is for the day you open the same workbook on another laptop, clear the browser, or pick up on your phone.',
            )
            .build(),
        )
        .build(),
      View('table')
        .class('pricing-compare')
        .children(
          View('thead')
            .children(
              View('tr')
                .children(
                  View('th').text('').build(),
                  View('th').text('This device · free').build(),
                  View('th').text('Cloud · from $5/year').build(),
                )
                .build(),
            )
            .build(),
          View('tbody')
            .children(
              row(
                'Open an attachment and fix a cell',
                'Yes — no account, no upload required',
                'Yes — after you sign in',
              ),
              row(
                'Same file on another device',
                'No — stays in this browser',
                'Yes — any signed-in browser',
              ),
              row(
                'Clear site data or switch computers',
                'Local library can be wiped',
                'Files stay in your account',
              ),
              row(
                'Privacy default',
                'Bytes stay on your device',
                'Stored in your account only when you choose cloud',
              ),
              row(
                'What you pay for',
                'Nothing — forever',
                'Cross-device storage from $5/year, not another Office seat',
              ),
            )
            .build(),
        )
        .build(),
    )
    .build();

  const faq = Div()
    .class('pricing-faq pricing-reveal d5')
    .children(
      View('h2').text('Questions').build(),
      View('dl')
        .class('pricing-faq-grid')
        .children(
          faqItem(
            'Is local editing really free?',
            'Yes. The This device library does not require an account or a paid plan. Cloud tiers are only for account storage across devices.',
          ),
          faqItem(
            'What do the cloud plans cost?',
            '$5/year for 1 GB (starter), or $10/year for 10 GB (best value — 10× storage for 2× price). Yearly billing through Stripe. You are paying for cross-device account storage, not a desktop Office license.',
          ),
          faqItem(
            'Which plan should I pick?',
            'Most people want cloud for a handful of active workbooks: start at 1 GB, or jump to 10 GB if you prefer not to think about quota.',
          ),
          faqItem(
            'How do I change or cancel a plan?',
            'Sign in, then use Manage billing on this page to open the Stripe customer portal.',
          ),
        )
        .build(),
    )
    .build();

  const band = Div()
    .class('pricing-band pricing-reveal d5')
    .children(
      Div()
        .children(
          View('h2').text('Start free on This device').build(),
          View('p')
            .text('Open Workspace, create or upload a workbook, and save in this browser. Add cloud later if you need it.')
            .build(),
        )
        .build(),
      Div()
        .class('pricing-band-actions')
        .children(
          button(
            'Open workspace',
            () => {
              window.location.assign(withLocale('/workspace', getLanguage()));
            },
            { type: 'primary', id: 'pricing-band-workspace' },
          ),
          button(
            user ? 'Choose a cloud plan' : 'Sign in for cloud',
            () => {
              if (user) {
                document.getElementById(`pricing-plan-${FEATURED_PLAN}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
              }
              window.location.assign(loginUrl());
            },
            { id: 'pricing-band-cloud' },
          ),
        )
        .build(),
    )
    .build();

  root.replaceChildren(hero, plans, actions, compare, faq, band);
})();

function row(label: string, local: string, cloud: string): HTMLElement {
  return View('tr')
    .children(
      View('th').attr('scope', 'row').text(label).build(),
      View('td').attr('data-label', 'This device · free').text(local).build(),
      View('td').attr('data-label', 'Cloud · from $5/year').text(cloud).build(),
    )
    .build();
}

function faqItem(q: string, a: string): HTMLElement {
  return Div()
    .class('pricing-faq-item')
    .children(View('dt').text(q).build(), View('dd').text(a).build())
    .build();
}
