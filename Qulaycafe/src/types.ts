// A category id (slug) such as 'birinchi_taom'. Categories are admin-managed
// rows now, not a fixed list, so this is deliberately an open string — the
// authoritative set for a restaurant comes from GET /api/categories.
export type Category = string;

/** An admin-managed menu section as returned by /api/categories. */
export interface MenuCategory {
  id: Category;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  /** How many dishes currently point at this category. */
  dishCount: number;
}

export type DietaryTag = 'vegetarian' | 'vegan' | 'gluten-free' | 'halal' | 'spicy' | 'chef-recommendation';

export interface CustomizationOption {
  id: string;
  name: string;
  price: number;
}

export interface CustomizationGroup {
  id: string;
  title: string;
  required: boolean;
  maxSelect?: number;
  options: CustomizationOption[];
}

export interface MenuItem {
  id: string;
  name: string; // canonical — always mirrors nameUz, used by kitchen/orders/receipts
  description: string; // canonical — always mirrors descriptionUz
  nameUz: string;
  nameRu: string;
  nameEn: string;
  descriptionUz: string;
  descriptionRu: string;
  descriptionEn: string;
  price: number;
  category: Category;
  image: string;
  // Availability is a plain on/off switch ("mavjud" / "tugadi"). There is
  // deliberately no numeric stock count: restaurants told us tracking a
  // quantity per dish was busywork they never kept accurate.
  isAvailable: boolean;
  dietary: DietaryTag[];
  prepTimeMinutes: number;
  calories?: number;
  customizations?: CustomizationGroup[];
}

export interface SelectedCustomization {
  groupTitle: string;
  optionName: string;
  price: number;
}

export interface CartItem {
  cartItemId: string;
  menuItem: MenuItem;
  quantity: number;
  selectedCustomizations: SelectedCustomization[];
  specialInstructions?: string;
  itemTotal: number;
}

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'served' | 'paid' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid';

export interface Order {
  id: string;
  tableNumber: number;
  customerName: string;
  customerPhoneOrEmail: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: 'cash' | 'card' | 'loyalty_points' | 'pay_at_counter';
  createdAt: string;
  updatedAt: string;
  estimatedMinutes: number;
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  orderNote?: string;
  orderType?: 'dine_in' | 'delivery' | 'pickup';
  deliveryAddress?: string;
  deliveryPhone?: string;
  // Precise geolocation the customer shared instead of (or alongside) a
  // typed address — sent to the courier as a real Telegram map pin.
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryFee?: number;
  courierId?: string;
  courierName?: string;
}

export interface LoyaltyMember {
  id: string;
  name: string;
  phoneOrEmail: string;
  confirmationCode: string;
  pointsBalance: number;
  tier: 'Silver' | 'Gold' | 'Platinum';
  totalSpent: number;
  ordersCount: number;
  joinedDate: string;
}

export interface Table {
  tableNumber: number;
  capacity: number;
  status: 'available' | 'seated' | 'ordering' | 'eating' | 'bill_requested';
  currentOrderId?: string;
  activeItemsCount?: number;
  comment?: string; // e.g. "near the window", "2nd floor terrace" — shown to the customer at that table
}

export interface InventoryLog {
  id: string;
  menuItemId: string;
  menuItemName: string;
  changeAmount: number;
  newStock: number;
  reason: 'customer_order' | 'restock' | 'manual_adjustment' | 'spoilage';
  timestamp: string;
}

export type AppViewMode = 'customer' | 'kitchen' | 'admin';

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  givenName?: string;
  phone?: string;
}

export interface WaiterCall {
  id: string;
  tableNumber: number;
  status: 'pending' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}
