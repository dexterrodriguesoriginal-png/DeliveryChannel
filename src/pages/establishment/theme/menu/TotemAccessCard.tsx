import { useCallback, useMemo, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, MonitorSmartphone, Printer, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { downloadBlob, qrPngBlob } from '../../../../lib/salon/qrImage';
import { printTotemQr, totemPublicUrl, totemQrFileName } from '../../../../lib/menu/totemAccess';
import './totemAccessCard.css';

export function TotemAccessCard({
  slug,
  storeName = '',
  origin,
}: {
  slug: string;
  storeName?: string;
  /** Testes passam a origem; no navegador usa a origem atual. */
  origin?: string;
}) {
  const qrBoxRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number>(0);
  const [notice, setNotice] = useState('');
  const currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const url = useMemo(() => totemPublicUrl(currentOrigin, slug), [currentOrigin, slug]);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setNotice(''), 4000);
  }, []);

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copiado.');
    } catch {
      flash('Não foi possível copiar automaticamente. Selecione o link e copie.');
    }
  }, [url, flash]);

  const downloadQr = useCallback(async () => {
    const svg = qrBoxRef.current?.querySelector('svg');
    if (!svg || !url) return;
    try {
      downloadBlob(await qrPngBlob(svg), totemQrFileName(slug));
      flash('Imagem do QR baixada.');
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : 'Não foi possível baixar o QR.');
    }
  }, [slug, url, flash]);

  const printQr = useCallback(() => {
    const svg = qrBoxRef.current?.querySelector('svg');
    if (!svg || !url) return;
    const opened = printTotemQr(svg, { url, storeName: storeName || 'Totem do salão' });
    if (!opened) flash('Permita pop-ups para imprimir o QR, ou use Baixar QR.');
  }, [url, storeName, flash]);

  if (!url) {
    return (
      <aside className="totem-access-card" data-testid="totem-access-card" data-ready="false">
        <div className="totem-access-title">
          <QrCode size={18} aria-hidden="true" />
          <div>
            <h3>Acessar o totem</h3>
            <p>O link do totem aparece quando a loja tiver um endereço (slug) válido.</p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="totem-access-card" data-testid="totem-access-card" data-ready="true">
      <div className="totem-access-title">
        <QrCode size={18} aria-hidden="true" />
        <div>
          <h3>Acessar o totem</h3>
          <p>Abra no aparelho do balcão, copie o link ou imprima o QR.</p>
        </div>
      </div>

      <label className="totem-access-link-label" htmlFor="totem-access-url">Link do totem</label>
      <div className="totem-access-link-row">
        <input
          id="totem-access-url"
          data-testid="totem-access-url"
          type="text"
          readOnly
          value={url}
          onFocus={event => event.currentTarget.select()}
        />
        <button type="button" className="theme-secondary" onClick={() => void copyLink()} data-testid="totem-access-copy">
          <Copy size={15} aria-hidden="true" />Copiar
        </button>
      </div>
      <div aria-live="polite" className="totem-access-toast-slot">
        {notice && <p role="status" data-testid="totem-access-toast">{notice}</p>}
      </div>

      <div className="totem-access-qr-row">
        <div className="totem-access-qr" ref={qrBoxRef} data-testid="totem-access-qr" aria-hidden="false">
          <QRCodeSVG value={url} size={180} level="Q" marginSize={2} title={`QR do totem: ${url}`} />
        </div>
        <div className="totem-access-qr-actions">
          <button type="button" className="theme-secondary" onClick={() => void downloadQr()} data-testid="totem-access-download">
            <Download size={15} aria-hidden="true" />Baixar QR
          </button>
          <button type="button" className="theme-secondary" onClick={printQr} data-testid="totem-access-print">
            <Printer size={15} aria-hidden="true" />Imprimir
          </button>
        </div>
      </div>

      <a
        className="theme-primary totem-access-open"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="totem-access-open"
      >
        <ExternalLink size={16} aria-hidden="true" />Abrir totem neste aparelho
      </a>

      <section className="totem-access-guide" data-testid="totem-access-guide">
        <p className="totem-access-recommended">Recomendado</p>
        <h4>
          <MonitorSmartphone size={16} aria-hidden="true" />
          Instalar como app (tela cheia)
        </h4>
        <p className="totem-access-guide-lead">
          Este é o caminho recomendado: o app instalado abre em tela cheia, sem o aviso do Chrome.
        </p>
        <details>
          <summary>Como instalar e fixar o totem</summary>
          <ul>
            <li><strong>Android (Chrome):</strong> no menu de três pontos, toque em <em>Instalar app</em> ou <em>Adicionar à tela inicial</em>.</li>
            <li><strong>iPhone e iPad (Safari):</strong> toque em <em>Compartilhar</em> e depois em <em>Adicionar à Tela de Início</em>.</li>
            <li>
              <strong>Fixar app no Android:</strong> em <em>Configurações &gt; Segurança</em>, ative <em>Fixar app</em> (Screen pinning).
              Assim o cliente não consegue sair do totem.
            </li>
            <li>
              <strong>Windows ou PC do totem (Chrome kiosk):</strong> feche as outras janelas e inicie o Chrome assim:
              <code>chrome --kiosk {url}</code>
            </li>
          </ul>
          <p className="totem-access-guide-note">
            Se o totem estiver em uma aba comum do Chrome, a tela cheia é pedida só uma vez, no toque do botão da capa — o aviso do navegador, se aparecer, surge no máximo uma vez. Depois de um tempo sem uso, o totem volta sozinho para a capa e limpa o pedido.
          </p>
        </details>
      </section>
    </aside>
  );
}
