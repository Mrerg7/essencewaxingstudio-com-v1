export const SITE = {
  url: 'https://essencewaxingstudio.com',
  name: 'Essence Waxing Studio',
  domain: 'EssenceWaxingStudio.com',
  seller: 'Desert Rich',
  email: 'sales@desertrich.com',
  price: '50000',
  priceDisplay: '$50,000',
  priceCurrency: 'USD',
  priceValidUntil: '2027-12-31',
  googleSiteVerification: 'i6UMzhT4OvHEhgRfKk0gaS8Fo1p3VHsxu6dsh1aK65k',
  ogImage:
    'https://customer-wa9cpywo3l4jte5c.cloudflarestream.com/a43755aabf7c31ea830b32dcce95b2a1/thumbnails/thumbnail.jpg?time=&height=600',
  ogImageAlt: 'Essence Waxing Studio — premium waxing studio domain for sale',
  escrow: 'https://www.escrow.com',
  streamId: 'a43755aabf7c31ea830b32dcce95b2a1',
  streamHost: 'customer-wa9cpywo3l4jte5c.cloudflarestream.com',
} as const;

export const ACQUISITION_MAILTO = (subject?: string, body?: string) => {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body ?? '');
  const qs = params.toString();
  return `mailto:${SITE.email}${qs ? `?${params.toString()}` : ''}`;
};
