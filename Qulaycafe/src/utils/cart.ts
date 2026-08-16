import { CartItem } from '../types';

// Price of ONE unit of a cart line: the dish plus whatever extras were picked
// for it. Quantity changes recompute from this instead of dividing itemTotal
// by the old quantity, which accumulated floating-point drift (and produced a
// wrong line total once a line had been incremented and decremented a few
// times).
export function cartUnitPrice(item: Pick<CartItem, 'menuItem' | 'selectedCustomizations'>): number {
  const extras = (item.selectedCustomizations || []).reduce((sum, c) => sum + (c.price || 0), 0);
  return (item.menuItem?.price || 0) + extras;
}

export function cartLineTotal(
  item: Pick<CartItem, 'menuItem' | 'selectedCustomizations'>,
  quantity: number
): number {
  return cartUnitPrice(item) * quantity;
}
