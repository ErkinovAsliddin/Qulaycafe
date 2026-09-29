import { describe, it, expect } from 'vitest';
import {
  findBoilerplateText,
  menuItemCreateSchema,
  restaurantRegisterSchema,
  categoryCreateSchema,
  brandingUpdateSchema
} from '../src/server/validation';

// Pure unit tests — no server, no database.
//
// Restaurant and dish names are printed verbatim on order cards and on the
// receipt itself (buildReceiptBytes in escpos.ts, printReceipt in
// AdminDashboard), where the header reads to a paying guest as the name of the
// business. Copy pasted out of an official document therefore ends up on a
// printed check, which is why these fields refuse it at the door.
//
// The negative cases matter as much as the positive ones: a guard that rejects
// a real cafe name is worse than the problem it prevents, so ordinary Uzbek,
// Russian, and English names are asserted to pass.

/** The three strings actually reported as appearing in the admin panel. */
const REPORTED = [
  "O'zbekiston Respublikasi Moliya vazirligi",
  "O'zbekiston Respublikasi Markaziy Banki",
  "O'zbekiston Respublikasi Vazirlar Mahkamasining majlisi to'g'risida axborot"
];

const validDish = {
  nameUz: 'Osh',
  nameRu: 'Плов',
  nameEn: 'Pilaf',
  price: 45000,
  category: 'ikkinchi_taom'
};

const validRestaurant = {
  name: 'Osh Markazi',
  phone: '+998901234567',
  password: 'secret123'
};

describe('findBoilerplateText: official-document text is refused', () => {
  it('flags each reported ministry, bank, and cabinet string', () => {
    for (const text of REPORTED) {
      expect(findBoilerplateText(text), text).not.toBeNull();
    }
  });

  it('flags Cyrillic ministry wording too', () => {
    expect(findBoilerplateText('Министерство финансов Республики Узбекистан')).not.toBeNull();
    expect(findBoilerplateText('Центральный банк')).not.toBeNull();
  });

  it('flags leftover template filler', () => {
    expect(findBoilerplateText('Lorem ipsum dolor sit amet')).not.toBeNull();
    expect(findBoilerplateText('Placeholder')).not.toBeNull();
  });

  it('flags a formal country name that no cafe is called', () => {
    expect(findBoilerplateText('Republic of Uzbekistan')).not.toBeNull();
  });
});

describe('findBoilerplateText: real names are never refused', () => {
  it('accepts ordinary Uzbek, Russian, and English names', () => {
    for (const name of [
      'Osh',
      'Osh Markazi',
      'Shashlik',
      'Только Русский',
      'Pilaf House',
      'Go\u2019shtli Somsa',
      'Test Dish',
      'Photo Test Dish',
      'Margin Test Dish'
    ]) {
      expect(findBoilerplateText(name), name).toBeNull();
    }
  });

  it('accepts "Respublika" on its own, because a cafe can be called that', () => {
    // Deliberately left off the pattern list: it is a real restaurant name, and
    // is only refused in combination with state-body wording.
    expect(findBoilerplateText('Respublika')).toBeNull();
    expect(findBoilerplateText('Respublika Restaurant')).toBeNull();
    expect(findBoilerplateText('Respublika Milliy Taomlari')).toBeNull();
  });
});

describe('restaurant name: the receipt header cannot be official boilerplate', () => {
  it('rejects registration with a reported string as the name', () => {
    for (const name of REPORTED) {
      const result = restaurantRegisterSchema.safeParse({ ...validRestaurant, name });
      expect(result.success).toBe(false);
    }
  });

  it('rejects the same text arriving later as the branding display name', () => {
    // This path writes restaurants.name — the exact line printed on a receipt.
    const result = brandingUpdateSchema.safeParse({ displayName: REPORTED[0] });
    expect(result.success).toBe(false);
  });

  it('still accepts a real restaurant name, phone, and password', () => {
    expect(restaurantRegisterSchema.safeParse(validRestaurant).success).toBe(true);
    expect(brandingUpdateSchema.safeParse({ displayName: 'Osh Markazi' }).success).toBe(true);
  });
});

describe('dish and category names: anything printed on a check is guarded', () => {
  it('rejects a boilerplate dish name in any language slot', () => {
    for (const field of ['nameUz', 'nameRu', 'nameEn'] as const) {
      const result = menuItemCreateSchema.safeParse({ ...validDish, [field]: REPORTED[1] });
      expect(result.success, field).toBe(false);
    }
  });

  it('rejects a boilerplate category name, which renders in the menu', () => {
    expect(categoryCreateSchema.safeParse({ nameUz: REPORTED[2] }).success).toBe(false);
  });

  it('leaves ordinary dishes and categories alone', () => {
    expect(menuItemCreateSchema.safeParse(validDish).success).toBe(true);
    expect(categoryCreateSchema.safeParse({ nameUz: 'Birinchi taom' }).success).toBe(true);
  });
});
