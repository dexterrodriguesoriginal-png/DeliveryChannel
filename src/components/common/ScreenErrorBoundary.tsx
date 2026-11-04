import React from 'react';

/** A render failure keeps a recovery screen available without exposing error details. */
export class ScreenErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Diagnostics only: error name/message and component stack, no props or state.
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('[ScreenErrorBoundary]', e.name, e.message, info?.componentStack ?? '');
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main role="alert" className="grid min-h-[100dvh] place-items-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-black">Não foi possível abrir esta tela</h1>
        <p className="text-sm text-slate-600">Tente novamente para continuar seu atendimento.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">Tentar novamente</button>
        <a href="/" className="block py-2 text-center text-sm font-bold underline">Voltar ao início</a>
      </section>
    </main>;
  }
}
