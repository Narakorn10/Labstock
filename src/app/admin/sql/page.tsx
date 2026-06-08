'use client';

import React, { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Database, Play, AlertCircle, CheckCircle2, Copy } from 'lucide-react';

export default function SqlExplorerPage() {
  const [query, setQuery] = useState('SELECT * FROM master_data LIMIT 10;');
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);

  const handleRunQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.runRawQuery(query);
      if (response.success && response.data) {
        setResults(response.data);
        setRowCount(response.data.length);
      } else {
        setError(response.error || "เกิดข้อผิดพลาดในการรัน Query");
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } }, message: string };
      setError(axiosError.response?.data?.error || axiosError.message);
    } finally {
      setLoading(false);
    }
  };

  const getTableHeaders = () => {
    if (results.length === 0) return [];
    return Object.keys(results[0]);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Database className="w-8 h-8 text-blue-600" />
        <h1 className="text-2xl font-bold">SQL Explorer (Neon Database)</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <span className="text-sm font-medium text-slate-600">Enter SQL Query</span>
          <button
            onClick={handleRunQuery}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <Play className="w-4 h-4" />}
            Run Query
          </button>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full h-40 p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          placeholder="Type your SQL query here..."
        />
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-bold">Error executing query</p>
            <p className="text-sm font-mono whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      )}

      {rowCount > 0 && (
        <div className="mb-4 flex items-center gap-2 text-green-700 font-medium">
          <CheckCircle2 className="w-5 h-5" />
          Query successful: {rowCount} rows returned.
        </div>
      )}

      {results.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 sticky top-0 border-b border-slate-200">
                  {getTableHeaders().map((header) => (
                    <th key={header} className="p-3 font-semibold text-slate-700 uppercase tracking-wider border-r border-slate-200">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    {getTableHeaders().map((header) => (
                      <td key={header} className="p-3 text-slate-600 border-r border-slate-100">
                        {row[header] === null ? <span className="text-slate-300 italic">null</span> : String(row[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && !error && (
        <div className="text-center py-20 text-slate-400">
          <Copy className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Results will appear here after you run a query.</p>
        </div>
      )}
    </div>
  );
}
