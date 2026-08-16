import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CustomizationGroup } from '../../types';
import { Language, translations } from '../../lib/translations';

// ---------------------------------------------------------------------------
// Editor for a dish's customization groups ("Size" → Small/Medium/Large,
// "Extras" → Cheese +5000, …). The customer side already renders these
// (ItemCustomizerModal) and the server already validates them
// (customizationGroupSchema); this is the missing admin-facing half.
//
// Deliberately stateless: the parent owns the array, so the same component
// serves both the "add dish" form (local state) and the "edit dish" modal
// (a field of the item being edited).
// ---------------------------------------------------------------------------

interface CustomizationEditorProps {
  value: CustomizationGroup[];
  onChange: (groups: CustomizationGroup[]) => void;
  lang: Language;
  /** Prefix for generated ids so add/edit forms never collide in the DOM. */
  idPrefix: string;
}

/** Mirrors the server's limits (customizationGroupSchema) so the UI can't build something the API will reject. */
const MAX_GROUPS = 20;
const MAX_OPTIONS_PER_GROUP = 30;
const MAX_TITLE_LENGTH = 120;
const MAX_OPTION_NAME_LENGTH = 120;
const MAX_SELECT = 20;

const slugify = (value: string, fallback: string): string => {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base || fallback;
};

export const CustomizationEditor: React.FC<CustomizationEditorProps> = ({ value, onChange, lang, idPrefix }) => {
  const t = translations[lang];
  const groups = value || [];

  const updateGroup = (index: number, patch: Partial<CustomizationGroup>) => {
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  };

  const addGroup = () => {
    if (groups.length >= MAX_GROUPS) return;
    onChange([
      ...groups,
      {
        // ids only have to be unique within one dish — the option/group id is
        // never referenced from anywhere else, the customer's cart stores
        // titles and names.
        id: `${idPrefix}_g${Date.now().toString(36)}`,
        title: '',
        required: false,
        maxSelect: 1,
        options: [{ id: `${idPrefix}_o${Date.now().toString(36)}`, name: '', price: 0 }]
      }
    ]);
  };

  const removeGroup = (index: number) => {
    onChange(groups.filter((_, i) => i !== index));
  };

  const addOption = (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group || group.options.length >= MAX_OPTIONS_PER_GROUP) return;
    updateGroup(groupIndex, {
      options: [...group.options, { id: `${idPrefix}_o${Date.now().toString(36)}`, name: '', price: 0 }]
    });
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: { name?: string; price?: number }) => {
    const group = groups[groupIndex];
    if (!group) return;
    updateGroup(groupIndex, {
      options: group.options.map((o, i) =>
        i === optionIndex
          ? {
              ...o,
              ...patch,
              // Keep the id readable and stable-ish, but never empty.
              id: patch.name !== undefined ? slugify(patch.name, o.id) : o.id
            }
          : o
      )
    });
  };

  const removeOption = (groupIndex: number, optionIndex: number) => {
    const group = groups[groupIndex];
    if (!group) return;
    // A group with no options would silently render as an empty block for the
    // customer, so the last one can't be removed — delete the group instead.
    if (group.options.length <= 1) return;
    updateGroup(groupIndex, { options: group.options.filter((_, i) => i !== optionIndex) });
  };

  return (
    <div className="space-y-2 border border-zinc-200 rounded-xl p-3 bg-zinc-50/50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase">{t.customizationsTitle}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{t.customizationsHint}</p>
        </div>
        <button
          type="button"
          onClick={addGroup}
          disabled={groups.length >= MAX_GROUPS}
          className="shrink-0 bg-white hover:bg-orange-50 disabled:opacity-50 border border-zinc-200 hover:border-orange-300 text-zinc-700 px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center space-x-1 transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>{t.customizationsAddGroup}</span>
        </button>
      </div>

      {groups.length === 0 && <p className="text-[11px] text-zinc-400 py-1">{t.customizationsEmpty}</p>}

      {groups.map((group, groupIndex) => (
        <div key={group.id || groupIndex} className="bg-white border border-zinc-200 rounded-xl p-2.5 space-y-2">
          <div className="flex items-start space-x-2">
            <input
              type="text"
              value={group.title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={e =>
                updateGroup(groupIndex, {
                  title: e.target.value,
                  id: slugify(e.target.value, group.id)
                })
              }
              placeholder={t.customizationsGroupTitlePlaceholder}
              className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-zinc-900 font-bold focus:border-orange-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => removeGroup(groupIndex)}
              aria-label={t.customizationsRemoveGroup}
              className="shrink-0 p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center flex-wrap gap-3">
            <label className="flex items-center space-x-1.5 text-[11px] font-medium text-zinc-600">
              <input
                type="checkbox"
                checked={!!group.required}
                onChange={e => updateGroup(groupIndex, { required: e.target.checked })}
                className="accent-orange-500"
              />
              <span>{t.customizationsRequired}</span>
            </label>
            <label className="flex items-center space-x-1.5 text-[11px] font-medium text-zinc-600">
              <span>{t.customizationsMaxSelect}</span>
              <input
                type="number"
                min={1}
                max={Math.min(group.options.length || 1, MAX_SELECT)}
                value={group.maxSelect ?? 1}
                onChange={e => {
                  const parsed = parseInt(e.target.value, 10);
                  updateGroup(groupIndex, {
                    maxSelect: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_SELECT) : 1
                  });
                }}
                className="w-14 bg-zinc-50 border border-zinc-200 rounded-lg p-1.5 text-center text-zinc-900 focus:border-orange-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            {group.options.map((option, optionIndex) => (
              <div key={option.id || optionIndex} className="flex items-center space-x-1.5">
                <input
                  type="text"
                  value={option.name}
                  maxLength={MAX_OPTION_NAME_LENGTH}
                  onChange={e => updateOption(groupIndex, optionIndex, { name: e.target.value })}
                  placeholder={t.customizationsOptionNamePlaceholder}
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-zinc-900 focus:border-orange-500 focus:outline-none"
                />
                <input
                  type="number"
                  step="500"
                  min={0}
                  value={option.price}
                  onChange={e => {
                    const parsed = parseFloat(e.target.value);
                    updateOption(groupIndex, optionIndex, { price: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 });
                  }}
                  placeholder="0"
                  aria-label={t.customizationsOptionPrice}
                  className="w-24 bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-right text-zinc-900 focus:border-orange-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeOption(groupIndex, optionIndex)}
                  disabled={group.options.length <= 1}
                  aria-label={t.customizationsRemoveOption}
                  className="shrink-0 p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addOption(groupIndex)}
              disabled={group.options.length >= MAX_OPTIONS_PER_GROUP}
              className="text-[10px] font-bold text-orange-600 hover:text-orange-700 disabled:opacity-50 flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>{t.customizationsAddOption}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Drops half-filled rows before the dish is saved: a group with no title or a
 * group whose every option is unnamed is noise, and the server's schema would
 * reject the empty strings anyway.
 */
export function cleanCustomizations(groups: CustomizationGroup[]): CustomizationGroup[] {
  return (groups || [])
    .map(group => {
      const options = group.options.filter(o => o.name.trim().length > 0);
      return {
        ...group,
        title: group.title.trim(),
        options: options.map(o => ({ ...o, name: o.name.trim(), price: Number(o.price) || 0 })),
        maxSelect: Math.min(Math.max(group.maxSelect || 1, 1), Math.max(Math.min(options.length, MAX_SELECT), 1))
      };
    })
    .filter(group => group.title.length > 0 && group.options.length > 0);
}
