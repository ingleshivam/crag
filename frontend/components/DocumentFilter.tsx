"use client";

interface Props {
  documents: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function DocumentFilter({ documents, selected, onChange }: Props) {
  if (documents.length === 0) return null;

  const toggle = (doc: string) =>
    onChange(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);

  return (
    <div className="px-6 py-2 border-b border-gray-800 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500 font-medium flex-shrink-0">Filter:</span>
      <button
        onClick={() => onChange([])}
        className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
          selected.length === 0
            ? "bg-emerald-600 text-white"
            : "bg-gray-800 text-gray-400 hover:bg-gray-700"
        }`}
      >
        All docs
      </button>
      {documents.map((doc) => (
        <button
          key={doc}
          onClick={() => toggle(doc)}
          title={doc}
          className={`text-xs px-2.5 py-1 rounded-full truncate max-w-[180px] transition-colors ${
            selected.includes(doc)
              ? "bg-emerald-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          {doc}
        </button>
      ))}
    </div>
  );
}
