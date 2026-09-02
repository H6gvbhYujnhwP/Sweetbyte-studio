import React, { useRef, useEffect, useCallback } from 'react';

const BORDER = '#e0e0dc';
const TEXT   = '#1a1a1a';
const MUTED  = '#888';
const BG     = '#f5f5f3';

const tools = [
  { cmd:'bold',          icon:'B',  title:'Bold',           style:{fontWeight:700} },
  { cmd:'italic',        icon:'I',  title:'Italic',         style:{fontStyle:'italic'} },
  { cmd:'underline',     icon:'U',  title:'Underline',      style:{textDecoration:'underline'} },
  { cmd:'strikeThrough', icon:'S',  title:'Strikethrough',  style:{textDecoration:'line-through'} },
  { type:'sep' },
  { cmd:'justifyLeft',   icon:'≡L', title:'Align left' },
  { cmd:'justifyCenter', icon:'≡C', title:'Align centre' },
  { cmd:'justifyRight',  icon:'≡R', title:'Align right' },
  { type:'sep' },
  { cmd:'insertUnorderedList', icon:'•—', title:'Bullet list' },
  { cmd:'insertOrderedList',   icon:'1—', title:'Numbered list' },
  { type:'sep' },
  { cmd:'indent',  icon:'→|', title:'Indent' },
  { cmd:'outdent', icon:'|←', title:'Outdent' },
  { type:'sep' },
  { cmd:'createLink', icon:'🔗', title:'Insert link', special:'link' },
  { cmd:'unlink',     icon:'⛓', title:'Remove link' },
];

const fontSizes = ['10px','11px','12px','13px','14px','16px','18px','20px','24px','28px','32px'];
const headings  = ['Normal','Heading 1','Heading 2','Heading 3'];

// Email-safe fonts. Verdana is the default per the Sweetbyte house style —
// readable at small sizes, near-universal client support. Operator can switch
// to any of the others via the toolbar.
const fontFamilies = [
  { label: 'Verdana',         value: 'Verdana, Geneva, sans-serif' },
  { label: 'Arial',           value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica',       value: 'Helvetica, Arial, sans-serif' },
  { label: 'Tahoma',          value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS',    value: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia',         value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New',     value: '"Courier New", Courier, monospace' },
];
const DEFAULT_FONT_FAMILY = fontFamilies[0].value;
const DEFAULT_FONT_SIZE   = '12px';

export default function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const lastValue = useRef(value);

  // Set initial content once
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
      lastValue.current = value;
    }
  }, []);

  // Sync incoming value changes (e.g. edit modal opening)
  useEffect(() => {
    if (editorRef.current && value !== lastValue.current) {
      editorRef.current.innerHTML = value || '';
      lastValue.current = value;
    }
  }, [value]);

  const emit = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValue.current = html;
    onChange(html);
  }, [onChange]);

  function exec(cmd, val = null) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    emit();
  }

  function handleLink() {
    const url = prompt('Enter URL:', 'https://');
    if (url) exec('createLink', url);
  }

  function handleFontSize(e) {
    // execCommand fontSize uses 1-7, so we use a workaround with span
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      document.execCommand('fontSize', false, '7');
      // Replace size="7" font tags with styled spans
      editorRef.current.querySelectorAll('font[size="7"]').forEach(el => {
        const span = document.createElement('span');
        span.style.fontSize = e.target.value;
        span.innerHTML = el.innerHTML;
        el.replaceWith(span);
      });
    }
    emit();
  }

  // Same trick as handleFontSize — execCommand('fontName') leaves <font face="">
  // which is deprecated and not reliably preserved when emails round-trip
  // through Gmail/Outlook. Replace with <span style="font-family:...">
  // immediately after, which every modern client respects.
  function handleFontFamily(e) {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      document.execCommand('fontName', false, '__SENTINEL_FONT__');
      editorRef.current.querySelectorAll('font[face="__SENTINEL_FONT__"]').forEach(el => {
        const span = document.createElement('span');
        span.style.fontFamily = e.target.value;
        span.innerHTML = el.innerHTML;
        el.replaceWith(span);
      });
    }
    emit();
  }

  function handleHeading(e) {
    exec('formatBlock', e.target.value === 'Normal' ? 'p' : e.target.value.replace('Heading ','h'));
  }

  function handleKeyDown(e) {
    // Tab key → indent
    if (e.key === 'Tab') {
      e.preventDefault();
      exec('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  }

  return (
    <div style={{ border: `0.5px solid ${BORDER}`, borderRadius: 7, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', background: BG, borderBottom: `0.5px solid ${BORDER}`, flexWrap: 'wrap' }}>

        {/* Heading picker */}
        <select onChange={handleHeading} defaultValue="Normal"
          style={{ fontSize: 11, padding: '3px 6px', border: `0.5px solid ${BORDER}`, borderRadius: 5, background: '#fff', color: TEXT, cursor: 'pointer', marginRight: 4 }}>
          {headings.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        {/* Font family picker */}
        <select onChange={handleFontFamily} defaultValue={DEFAULT_FONT_FAMILY}
          style={{ fontSize: 11, padding: '3px 6px', border: `0.5px solid ${BORDER}`, borderRadius: 5, background: '#fff', color: TEXT, cursor: 'pointer', marginRight: 4, maxWidth: 110 }}>
          {fontFamilies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        {/* Font size picker */}
        <select onChange={handleFontSize} defaultValue={DEFAULT_FONT_SIZE}
          style={{ fontSize: 11, padding: '3px 6px', border: `0.5px solid ${BORDER}`, borderRadius: 5, background: '#fff', color: TEXT, cursor: 'pointer', marginRight: 4 }}>
          {fontSizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {tools.map((t, i) => {
          if (t.type === 'sep') return <div key={i} style={{ width: 1, height: 18, background: BORDER, margin: '0 4px' }} />;
          return (
            <button key={t.cmd} title={t.title}
              onMouseDown={e => { e.preventDefault(); t.special === 'link' ? handleLink() : exec(t.cmd); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontSize: t.icon.length > 2 ? 13 : 12, fontWeight: 500, color: TEXT, minWidth: 24, ...t.style }}>
              {t.icon}
            </button>
          );
        })}

        {/* Text colour */}
        <input type="color" title="Text colour" defaultValue="#1a1a1a"
          onChange={e => exec('foreColor', e.target.value)}
          style={{ width: 22, height: 22, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 3, background: 'none' }} />

        {/* Background colour */}
        <input type="color" title="Background colour" defaultValue="#ffffff"
          onChange={e => exec('hiliteColor', e.target.value)}
          style={{ width: 22, height: 22, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 3, background: 'none' }} />
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyDown={handleKeyDown}
        onBlur={emit}
        style={{
          minHeight: 220,
          padding: '12px 14px',
          fontSize: 12,
          color: TEXT,
          background: '#fff',
          outline: 'none',
          lineHeight: 1.6,
          fontFamily: DEFAULT_FONT_FAMILY,
        }}
      />
    </div>
  );
}
