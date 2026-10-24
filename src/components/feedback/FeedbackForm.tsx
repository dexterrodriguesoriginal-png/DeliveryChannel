import React, { useState } from 'react';
import {
  feedbackAreas,
  feedbackTypes,
  FeedbackInput,
  validFeedback,
} from '../../lib/feedback/model';
import { feedbackRepository } from '../../repositories/feedbackRepository';
export function FeedbackForm({ slug }: { slug: string }) {
  const [type, setType] = useState<FeedbackInput['type']>('sugestao');
  const [area, setArea] = useState('');
  const [rating, setRating] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const input: FeedbackInput = {
    type,
    area: (area as FeedbackInput['area']) || null,
    rating: rating ? Number(rating) : null,
    message: message.trim(),
  };
  if (sent)
    return (
      <div role="status" className="p-5 space-y-3">
        <p>Obrigado! Seu relato foi enviado à loja.</p>
        <button
          onClick={() => {
            setSent(false);
            setMessage('');
          }}
        >
          Enviar outro relato
        </button>
      </div>
    );
  return (
    <form
      className="p-4 space-y-4 text-gray-900 bg-white"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!validFeedback(input)) {
          setError('Escreva entre 10 e 1000 caracteres.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          await feedbackRepository.submit(slug, input);
          setSent(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-bold">
        Enviar sugestão, elogio ou reclamação
      </h2>
      <p className="text-sm">
        A loja não recebe sua identidade, nem o horário exato. Evite incluir
        nome, telefone, email, pedido ou detalhes que identifiquem você.
        Disponível com ou sem login.
      </p>
      <label className="block">
        Tipo
        <select
          className="block w-full border rounded-lg p-2"
          value={type}
          onChange={(e) => setType(e.target.value as FeedbackInput['type'])}
        >
          {Object.entries(feedbackTypes).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Área (opcional)
        <select
          className="block w-full border rounded-lg p-2"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="">Sem área</option>
          {Object.entries(feedbackAreas).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Nota (opcional)
        <select
          className="block w-full border rounded-lg p-2"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        >
          <option value="">Sem nota</option>
          {[1, 2, 3, 4, 5].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="block">
        Mensagem
        <textarea
          required
          rows={5}
          minLength={10}
          maxLength={1000}
          className="block w-full border rounded-lg p-2"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <p className="text-xs">
        {[...message.trim()].length}/1000 · até 5 envios por dia por loja.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy || !validFeedback(input)}
        className="bg-emerald-800 text-white rounded-lg p-3 disabled:opacity-50"
      >
        {busy ? 'Enviando…' : 'Enviar relato'}
      </button>
    </form>
  );
}
