import React from 'react';

interface FilterSheetProps {
  onClose: () => void;
  availableTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  hoursThreshold: number;
  onHoursChange: (hours: number) => void;
  onlyFavorites: boolean;
  onToggleFavorites: () => void;
  onClear: () => void;
}

export const FilterSheet: React.FC<FilterSheetProps> = ({
  onClose,
  availableTags,
  selectedTags,
  onToggleTag,
  hoursThreshold,
  onHoursChange,
  onlyFavorites,
  onToggleFavorites,
  onClear,
}) => {
  return (
    <div className="bg-white/95 backdrop-blur-md rounded-t-[2.5rem] shadow-[0_-12px_40px_-15px_rgba(0,0,0,0.15)] border-t border-slate-100 flex flex-col max-h-[85vh] overflow-hidden transition-all duration-300">
      
      {/* Drag Handle Bar */}
      <div className="w-full pt-3 pb-1 flex flex-col items-center justify-center">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1"></div>
      </div>

      <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-slate-50">
        <h3 className="text-sm font-bold text-slate-400 tracking-wider uppercase">Advanced Filters</h3>
        <button onClick={onClose} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 text-xs w-7 h-7 flex items-center justify-center font-bold">
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-5 space-y-6">
        
        {/* Favorites only */}
        <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl">
          <div>
            <span className="text-sm font-bold text-slate-800">Favorites Only</span>
            <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Show only your saved bars</p>
          </div>
          <input
            type="checkbox"
            checked={onlyFavorites}
            onChange={onToggleFavorites}
            className="w-5 h-5 text-slate-900 border-slate-300 rounded focus:ring-slate-900 accent-slate-900"
          />
        </div>

        {/* Minimum hours duration */}
        <div className="space-y-2.5">
          <span className="text-xs font-bold text-slate-400 tracking-wider uppercase block">Minimum Sun Exposure Today</span>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((hr) => (
              <button
                key={hr}
                onClick={() => onHoursChange(hr)}
                className={`py-2.5 text-xs font-bold rounded-xl border transition-colors ${
                  hoursThreshold === hr
                    ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                ≥ {hr} hr{hr > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Categories multiselect */}
        <div className="space-y-2.5">
          <span className="text-xs font-bold text-slate-400 tracking-wider uppercase block">Filter Categories</span>
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((t) => {
              const isSelected = selectedTags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => onToggleTag(t)}
                  className={`px-3 py-2 rounded-full text-xs font-bold border transition-colors ${
                    isSelected
                      ? 'bg-amber-100 border-amber-300 text-amber-800 shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 flex gap-2.5">
          <button
            onClick={onClear}
            className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold transition-all"
          >
            Reset Filters
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};