import React, { useState } from 'react';
import { Table } from '../../types';
import { QrCode, CheckCircle2, Utensils, Users, Sparkles } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface TableConfirmModalProps {
  isOpen: boolean;
  currentTable: number | null;
  tables: Table[];
  onConfirm: (tableNumber: number) => void;
  lang: Language;
}

export const TableConfirmModal: React.FC<TableConfirmModalProps> = ({
  isOpen,
  currentTable,
  tables,
  onConfirm,
  lang
}) => {
  const t = translations[lang];
  const [selectedTable, setSelectedTable] = useState<number>(currentTable || 1);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
        
        <div className="text-center mb-6">
          <div className="inline-flex p-3 bg-orange-50 border border-orange-100 text-orange-600 rounded-xl mb-3 shadow-sm">
            <QrCode className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-zinc-900 italic">GOURMET BISTRO</h2>
          <p className="text-zinc-500 text-xs mt-1 font-medium">
            {t.confirmTableDesc}
          </p>
        </div>

        {/* Selected Table Hero Card */}
        <div className="bg-orange-50/70 border border-orange-100 rounded-xl p-4 text-center mb-6">
          <span className="text-[10px] uppercase tracking-widest text-orange-800 font-bold">{t.yourSeatedTable}</span>
          <div className="text-3xl font-extrabold text-zinc-900 mt-1">
            {t.table} #{selectedTable}
          </div>
          <div className="flex items-center justify-center space-x-2 text-zinc-500 text-xs mt-2 font-medium">
            <Users className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t.capacityGuests.replace('{cap}', String(tables.find(t => t.tableNumber === selectedTable)?.capacity || 4))}</span>
            <span>•</span>
            <span className="text-green-600 font-bold">{t.scanVerified}</span>
          </div>
        </div>

        {/* Quick Table Grid Selection */}
        <div className="mb-6">
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
            {t.selectTable.replace('#{num}', '')}:
          </label>
          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
            {tables.map((tbl) => (
              <button
                key={tbl.tableNumber}
                type="button"
                onClick={() => setSelectedTable(tbl.tableNumber)}
                className={`py-2.5 px-2 rounded-lg text-xs font-bold transition-all border ${
                  selectedTable === tbl.tableNumber
                    ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                T-{tbl.tableNumber}
              </button>
            ))}
          </div>
        </div>

        {/* Confirm Action Button */}
        <button
          onClick={() => onConfirm(selectedTable)}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-orange-500/20 flex items-center justify-center space-x-2 transition-all transform active:scale-98"
        >
          <CheckCircle2 className="w-5 h-5" />
          <span>{t.confirmTableTitle} #{selectedTable}</span>
        </button>

        <p className="text-[11px] text-zinc-400 text-center mt-3 font-medium">
          {t.ordersSentToPOS.replace('{num}', String(selectedTable))}
        </p>

      </div>
    </div>
  );
};

