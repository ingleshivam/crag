interface Props {
  chunks: string[];
}

export default function ChunksPanel({ chunks }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Retrieved Chunks
      </h2>

      {chunks.length === 0 ? (
        <p className="text-gray-600 text-xs">Retrieved document chunks appear here.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {chunks.map((chunk, i) => (
            <div key={i} className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-400 mb-1.5">Chunk {i + 1}</div>
              <p className="text-xs text-gray-300 leading-relaxed line-clamp-5">{chunk}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
