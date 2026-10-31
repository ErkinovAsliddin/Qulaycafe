import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { MenuItem } from '../../types';

interface SortableMenuItemRowProps {
  item: MenuItem;
  renderContent: (item: MenuItem) => React.ReactNode;
}

function SortableMenuItemRow({ item, renderContent }: SortableMenuItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center group">
      <button
        {...attributes}
        {...listeners}
        className="p-2 text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0 touch-none"
        title="Tartibni o'zgartirish"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">{renderContent(item)}</div>
    </div>
  );
}

interface MenuItemSortableListProps {
  items: MenuItem[];
  categoryId: string;
  renderItem: (item: MenuItem) => React.ReactNode;
  onReorder: (categoryId: string, ids: string[]) => Promise<void>;
}

export function MenuItemSortableList({ items, categoryId, renderItem, onReorder }: MenuItemSortableListProps) {
  const [localItems, setLocalItems] = useState(items);
  const [saving, setSaving] = useState(false);

  // Sync if parent items change (e.g. after add/delete)
  React.useEffect(() => { setLocalItems(items); }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex(i => i.id === active.id);
    const newIndex = localItems.findIndex(i => i.id === over.id);
    const reordered = arrayMove(localItems, oldIndex, newIndex);
    setLocalItems(reordered);
    setSaving(true);
    try {
      await onReorder(categoryId, reordered.map(i => i.id));
    } catch {
      setLocalItems(items); // revert on error
    } finally {
      setSaving(false);
    }
  }, [localItems, items, categoryId, onReorder]);

  return (
    <div className="relative">
      {saving && (
        <div className="absolute top-0 right-0 text-[10px] text-zinc-400 font-bold px-2 py-1">Saqlanmoqda...</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {localItems.map(item => (
            <SortableMenuItemRow key={item.id} item={item} renderContent={renderItem} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
