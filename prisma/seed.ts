import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const books = [
  { slug: 'the-alchemist', title: 'The Alchemist', author: 'Paulo Coelho', genre: 'Fiction', price: 39900, sale: 29900, sales: 128, featured: true, staff: true, newest: false, trending: true },
  { slug: 'atomic-habits', title: 'Atomic Habits', author: 'James Clear', genre: 'Self Help', price: 79900, sale: 59900, sales: 245, featured: true, staff: false, newest: false, trending: true },
  { slug: 'ikigai', title: 'Ikigai', author: 'Héctor García & Francesc Miralles', genre: 'Self Help', price: 49900, sale: 34900, sales: 184, featured: false, staff: true, newest: false, trending: true },
  { slug: 'the-midnight-library', title: 'The Midnight Library', author: 'Matt Haig', genre: 'Fiction', price: 59900, sale: 44900, sales: 156, featured: true, staff: true, newest: true, trending: true },
  { slug: 'sapiens', title: 'Sapiens', author: 'Yuval Noah Harari', genre: 'History', price: 89900, sale: 69900, sales: 211, featured: false, staff: false, newest: false, trending: true },
  { slug: 'the-psychology-of-money', title: 'The Psychology of Money', author: 'Morgan Housel', genre: 'Finance', price: 69900, sale: 49900, sales: 198, featured: true, staff: false, newest: true, trending: true },
  { slug: 'the-great-gatsby', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', genre: 'Classics', price: 29900, sale: 22900, sales: 91, featured: false, staff: true, newest: false, trending: false },
  { slug: 'a-man-called-ove', title: 'A Man Called Ove', author: 'Fredrik Backman', genre: 'Fiction', price: 54900, sale: 39900, sales: 143, featured: false, staff: false, newest: true, trending: false },
];

async function main() {
  const permissions = ['book:read','book:write','inventory:write','order:read','order:write','order:refund','customer:read','content:write','support:write','analytics:read'];
  const role = await db.role.upsert({
    where: { name: 'owner' },
    update: { permissions: JSON.stringify(permissions) },
    create: { name: 'owner', label: 'Owner', description: 'Full store access', permissions: JSON.stringify(permissions), isSystem: true },
  });

  const publisher = await db.publisher.upsert({
    where: { slug: 'penguin-random-house' },
    update: {},
    create: { slug: 'penguin-random-house', name: 'Penguin Random House', description: 'A global publishing house.' },
  });

  const genres = new Map<string, string>();
  for (const name of ['Fiction','Self Help','History','Finance','Classics']) {
    const g = await db.genre.upsert({
      where: { slug: name.toLowerCase().replace(/\s+/g, '-') },
      update: { isFeatured: true },
      create: { slug: name.toLowerCase().replace(/\s+/g, '-'), name, isFeatured: true },
    });
    genres.set(name, g.id);
  }

  const warehouse = await db.warehouse.upsert({
    where: { code: 'KOL-01' },
    update: {},
    create: { code: 'KOL-01', name: 'Kolkata Warehouse', city: 'Kolkata', state: 'West Bengal', country: 'IN', priority: 1 },
  });

  const indiaZone = await db.shippingZone.upsert({
    where: { code: 'IN-ALL' },
    update: { name: 'India', countries: '["IN"]', priority: 1, isActive: true },
    create: { code: 'IN-ALL', name: 'India', countries: '["IN"]', priority: 1 },
  });

  await db.shippingMethod.upsert({
    where: { code: 'STANDARD' },
    update: { zoneId: indiaZone.id, isActive: true },
    create: { zoneId: indiaZone.id, code: 'STANDARD', label: 'Standard delivery', description: 'Reliable delivery across India', ratePaise: 5900, freeAbovePaise: 79900, minDays: 3, maxDays: 7, sortOrder: 1 },
  });
  await db.shippingMethod.upsert({
    where: { code: 'EXPRESS' },
    update: { zoneId: indiaZone.id, isActive: true },
    create: { zoneId: indiaZone.id, code: 'EXPRESS', label: 'Express delivery', description: 'Faster delivery on eligible pin codes', ratePaise: 9900, minDays: 1, maxDays: 3, sortOrder: 2 },
  });

  // International shipping is deliberately configuration-driven. The `*`
  // country entry is a catch-all zone, while the priority keeps India-specific
  // rates above it. Rates are stored in the store's base currency (INR) until
  // a live FX/pricing provider is configured; customers can still pay through
  // the configured international payment provider.
  const internationalZone = await db.shippingZone.upsert({
    where: { code: 'INTL-ALL' },
    update: { name: 'International', countries: '["*"]', priority: 100, isActive: true },
    create: { code: 'INTL-ALL', name: 'International', countries: '["*"]', priority: 100 },
  });

  await db.shippingMethod.upsert({
    where: { code: 'INTL-STANDARD' },
    update: { zoneId: internationalZone.id, isActive: true },
    create: {
      zoneId: internationalZone.id,
      code: 'INTL-STANDARD',
      label: 'International standard',
      description: 'Tracked international delivery; final transit time varies by destination and customs.',
      ratePaise: 149900,
      minDays: 7,
      maxDays: 21,
      sortOrder: 1,
    },
  });
  await db.shippingMethod.upsert({
    where: { code: 'INTL-EXPRESS' },
    update: { zoneId: internationalZone.id, isActive: true },
    create: {
      zoneId: internationalZone.id,
      code: 'INTL-EXPRESS',
      label: 'International express',
      description: 'Faster tracked international delivery; customs processing may affect the estimate.',
      ratePaise: 299900,
      minDays: 3,
      maxDays: 10,
      sortOrder: 2,
    },
  });

  await db.taxRate.upsert({
    where: { code: 'books_print' },
    update: { rateBp: 0, isInclusive: true },
    create: { code: 'books_print', label: 'Printed books', country: 'IN', rateBp: 0, isInclusive: true, hsnCode: '4901' },
  });

  for (const key of ['reviews','wishlist','newsletter','support_tickets','blog']) {
    await db.featureFlag.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, rolloutPercent: 100 } });
  }

  await db.setting.upsert({ where: { key: 'store.currency' }, update: {}, create: { key: 'store.currency', value: 'INR', type: 'string', group: 'store', label: 'Currency', isPublic: true } });
  await db.setting.upsert({ where: { key: 'store.name' }, update: {}, create: { key: 'store.name', value: 'Paperlane Books', type: 'string', group: 'store', label: 'Store name', isPublic: true } });

  for (const item of books) {
    const authorSlug = item.author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const author = await db.author.upsert({
      where: { slug: authorSlug },
      update: {},
      create: { slug: authorSlug, name: item.author, isFeatured: item.featured },
    });
    const book = await db.book.upsert({
      where: { slug: item.slug },
      update: {
        title: item.title, authorId: author.id, publisherId: publisher.id, genreId: genres.get(item.genre),
        pricePaise: item.price, salePricePaise: item.sale, salesCount: item.sales, status: 'active',
        isFeatured: item.featured, isStaffPick: item.staff, isNewRelease: item.newest, isTrending: item.trending,
        publishedAt: new Date(), coverImageUrl: '/book-placeholder.svg', coverAlt: `${item.title} cover`,
      },
      create: {
        slug: item.slug, title: item.title, authorId: author.id, publisherId: publisher.id, genreId: genres.get(item.genre),
        description: `Discover ${item.title} — a carefully selected title from the Paperlane Books catalogue.`,
        synopsis: `A reader-friendly introduction to ${item.title}.`, language: 'English', format: 'paperback',
        pricePaise: item.price, salePricePaise: item.sale, taxCategory: 'books_print', taxInclusive: true,
        salesCount: item.sales, ratingAvg: 4.4, ratingCount: 12, status: 'active',
        isFeatured: item.featured, isStaffPick: item.staff, isNewRelease: item.newest, isTrending: item.trending,
        publishedAt: new Date(), coverImageUrl: '/book-placeholder.svg', coverAlt: `${item.title} cover`,
      },
    });
    await db.inventoryItem.upsert({
      where: { sku: `PL-${item.slug.toUpperCase()}` },
      update: { onHand: 25 },
      create: { bookId: book.id, warehouseId: warehouse.id, sku: `PL-${item.slug.toUpperCase()}`, onHand: 25, lowStockThreshold: 5, costPaise: Math.round(item.sale * 0.7) },
    });
  }

  console.log(`Seeded ${books.length} books, catalogue data, inventory, shipping and store settings.`);
  console.log(`Owner role: ${role.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
