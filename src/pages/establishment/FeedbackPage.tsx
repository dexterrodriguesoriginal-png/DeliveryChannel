import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { feedbackRepository } from '../../repositories/feedbackRepository';
import {
  feedbackAreas,
  EMPTY_FEEDBACK_STATS,
  feedbackTypes,
  StoreFeedback,
} from '../../lib/feedback/model';
export function FeedbackPage() {
  const { activeTenant } = useAuth();
  const slug = activeTenant?.slug || '';
  const [filters, setFilters] = useState({
    type: '',
    area: '',
    from: '',
    to: '',
  });
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState('all');
  const [stats, setStats] = useState(EMPTY_FEEDBACK_STATS);
  const [rows, setRows] = useState<StoreFeedback[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    setRows([]);
    setError('');
    setLoading(true);
    if (!slug) {
      setLoading(false);
      return;
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      setError('O início deve ser anterior ao fim do período.');
      setLoading(false);
      return;
    }
    feedbackRepository
      .list(slug, { ...filters, state, offset })
      .then((r) => {
        if (alive) {
          setRows(r.rows);
          setStats(r.stats);
          if (!r.rows.length && offset > 0 && r.stats.total <= offset) {
            setOffset(Math.max(0, Math.floor((r.stats.total - 1) / 50) * 50));
          }
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, filters, state, offset, refresh]);
  useEffect(() => {
    setOffset(0);
  }, [slug, filters, state]);
  async function update(row: StoreFeedback, read: boolean, archived: boolean) {
    setBusy(row.id);
    setError('');
    try {
      await feedbackRepository.setState(slug, row, read, archived);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-5 p-4">
      <h1 className="text-2xl font-bold">Voz do cliente</h1>
      <p>
        Relatos anônimos · todos os planos. Datas exibidas somente por dia
        (UTC).
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          Tipo
          <select
            className="block border p-2 rounded"
            value={filters.type}
            onChange={(e) =>
              setFilters((f) => ({ ...f, type: e.target.value }))
            }
          >
            <option value="">Todos</option>
            {Object.entries(feedbackTypes).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Área
          <select
            className="block border p-2 rounded"
            value={filters.area}
            onChange={(e) =>
              setFilters((f) => ({ ...f, area: e.target.value }))
            }
          >
            <option value="">Todas</option>
            {Object.entries(feedbackAreas).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input
            type="date"
            className="block border p-2 rounded"
            value={filters.from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value }))
            }
          />
        </label>
        <label>
          Até
          <input
            type="date"
            className="block border p-2 rounded"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
        <label>
          Estado
          <select
            className="block border p-2 rounded"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="active">Não arquivados</option>
            <option value="unread">Não lidos</option>
            <option value="archived">Arquivados</option>
          </select>
        </label>
        <button onClick={() => setRefresh((n) => n + 1)}>Atualizar</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Carregando…</p>
      ) : (
        !error && (
          <>
            <div className="flex flex-wrap gap-4 bg-white p-4 rounded-xl border">
              <p>
                Total: <strong>{stats.total}</strong>
              </p>
              <p>
                Não lidos: <strong>{stats.unread}</strong>
              </p>
              <p>
                Nota média:{' '}
                <strong>{stats.average?.toFixed(1) ?? 'Sem notas'}</strong>
              </p>
              {Object.entries(feedbackTypes).map(([v, l]) => (
                <p key={v}>
                  {l}: {stats.types[v as keyof typeof feedbackTypes]}
                </p>
              ))}
            </div>
            <section className="bg-white border rounded-xl p-4">
              <h2 className="font-bold">Tendência semanal no período</h2>
              <table className="w-full text-left">
                <caption className="sr-only">
                  Volume e nota média por semana
                </caption>
                <thead>
                  <tr>
                    <th>Semana de</th>
                    <th>Relatos</th>
                    <th>Nota média</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.weeks.map((w) => (
                    <tr key={w.week}>
                      <td>{w.week}</td>
                      <td>{w.total}</td>
                      <td>{w.average?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {!rows.length && <p>Nenhum relato neste filtro.</p>}
            {rows.map((r) => (
              <article
                key={r.id}
                className="p-4 rounded-xl border bg-white space-y-3"
              >
                <p className="font-semibold">
                  {feedbackTypes[r.type]} ·{' '}
                  {r.area ? feedbackAreas[r.area] : 'Sem área'} · {r.day} ·{' '}
                  {r.rating ? `${r.rating}/5` : 'Sem nota'}
                  {r.archived ? ' · Arquivado' : ''}
                  {!r.is_read ? ' · Não lido' : ''}
                </p>
                <p className="whitespace-pre-wrap break-words">{r.message}</p>
                <div className="flex gap-4">
                  <button
                    disabled={busy === r.id}
                    onClick={() => update(r, !r.is_read, r.archived)}
                  >
                    {r.is_read ? 'Marcar como não lida' : 'Marcar como lida'}
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => update(r, r.is_read, !r.archived)}
                  >
                    {r.archived ? 'Desarquivar' : 'Arquivar'}
                  </button>
                </div>
              </article>
            ))}
            <nav aria-label="Páginas de relatos" className="flex gap-4">
              <button
                disabled={offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                Anterior
              </button>
              <span>
                {stats.total ? offset + 1 : 0}–
                {Math.min(offset + 50, stats.total)} de {stats.total}
              </span>
              <button
                disabled={offset + 50 >= stats.total}
                onClick={() => setOffset((n) => n + 50)}
              >
                Próxima
              </button>
            </nav>
          </>
        )
      )}
    </div>
  );
}
export function CeoFeedbackCounts() {
  const [rows, setRows] = useState<
    { store_id: string; store_name: string; total: number }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    feedbackRepository
      .ceoCounts()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="bg-white p-4 border rounded-xl space-y-3">
      <h2 className="font-bold">Voz do cliente — contagem por loja</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Loja</th>
              <th>Relatos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.store_id}>
                <td>{r.store_name}</td>
                <td>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
