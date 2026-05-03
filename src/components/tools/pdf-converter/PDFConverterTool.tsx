'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { marked } from 'marked';
import { FileText, Trash2, RefreshCw, CheckCircle2, AlertCircle, Settings2 } from 'lucide-react';
import { FileUploader } from '../FileUploader';
import { ProcessingProgress, ProcessingStatus } from '../ProcessingProgress';
import { DownloadButton } from '../DownloadButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { pdfToMarkdown } from '@/lib/pdf/processors/pdf-to-markdown';
import { pdfToDocx } from '@/lib/pdf/processors/pdf-to-docx';
import { ocrPDF } from '@/lib/pdf/processors/ocr';
import type { UploadedFile, ProcessOutput } from '@/types/pdf';
import { sanitizeHtml } from '@/lib/utils/html-sanitizer';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface PDFConverterToolProps {
  className?: string;
}

export function PDFConverterTool({ className = '' }: PDFConverterToolProps) {
  const t = useTranslations('common');
  const tTools = useTranslations('tools');

  const [file, setFile] = useState<UploadedFile | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [markdownBlob, setMarkdownBlob] = useState<Blob | null>(null);
  const [txtBlob, setTxtBlob] = useState<Blob | null>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [docxError, setDocxError] = useState<string | null>(null);
  const [ocrFallback, setOcrFallback] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'source' | 'text'>('preview');
  const [includePageNumbers, setIncludePageNumbers] = useState(false);
  const [pageRange, setPageRange] = useState('');
  const [preserveLineBreaks, setPreserveLineBreaks] = useState(true);

  const cancelledRef = useRef(false);

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    if (newFiles.length > 0) {
      const uploadedFile: UploadedFile = {
        id: generateId(),
        file: newFiles[0],
        status: 'pending' as const,
      };
      setFile(uploadedFile);
      setError(null);
      setDocxError(null);
      setMarkdownBlob(null);
      setTxtBlob(null);
      setDocxBlob(null);
      setMarkdownContent('');
      setHtmlContent('');
      setStatus('idle');
      setProgress(0);
      setOcrFallback(false);
    }
  }, []);

  const handleUploadError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleRemoveFile = useCallback(() => {
    setFile(null);
    setMarkdownBlob(null);
    setTxtBlob(null);
    setDocxBlob(null);
    setMarkdownContent('');
    setHtmlContent('');
    setError(null);
    setDocxError(null);
    setStatus('idle');
    setProgress(0);
    setOcrFallback(false);
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    setStatus('idle');
    setProgress(0);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) {
      setError(t('errors.uploadFile') || 'Please upload a PDF file.');
      return;
    }

    cancelledRef.current = false;
    setStatus('processing');
    setProgress(0);
    setProgressMessage('Starting conversion...');
    setError(null);
    setDocxError(null);
    setMarkdownBlob(null);
    setTxtBlob(null);
    setDocxBlob(null);
    setMarkdownContent('');
    setHtmlContent('');
    setOcrFallback(false);

    const baseName = file.file.name.replace(/\.pdf$/i, '');

    const runOcrFallback = async () => {
      setProgress(45);
      setProgressMessage('Running OCR fallback for scanned pages...');
      const ocrOutput = await ocrPDF(
        file.file,
        {
          outputFormat: 'text',
          languages: ['eng'],
          scale: 2,
          pages: [],
          preserveLayout: true,
        },
        (prog, message) => {
          if (!cancelledRef.current) {
            setProgress(45 + Math.round((prog / 100) * 20));
            setProgressMessage(message || 'OCR processing...');
          }
        }
      );

      if (cancelledRef.current) {
        return null;
      }

      if (ocrOutput.success && ocrOutput.result instanceof Blob) {
        const text = await ocrOutput.result.text();
        if (text.trim()) {
          setOcrFallback(true);
          return text.trim();
        }
      }

      return null;
    };

    try {
      let markdownText = '';

      try {
        const output: ProcessOutput = await pdfToMarkdown(
          file.file,
          {
            includePageNumbers,
            pageRange,
            preserveLineBreaks,
          },
          (prog, message) => {
            if (!cancelledRef.current) {
              setProgress(Math.round((prog / 100) * 40));
              setProgressMessage(message || 'Extracting PDF text...');
            }
          }
        );

        if (cancelledRef.current) {
          setStatus('idle');
          return;
        }

        if (output.success && output.result instanceof Blob) {
          markdownText = await output.result.text();
        }
      } catch (err) {
        console.warn('Markdown extraction failed, will try OCR fallback.', err);
      }

      if (!markdownText.trim()) {
        const ocrText = await runOcrFallback();
        if (cancelledRef.current) {
          setStatus('idle');
          return;
        }
        if (ocrText) {
          markdownText = `# OCR Extracted Text\n\n${ocrText}`;
        }
      }

      if (!markdownText.trim()) {
        throw new Error('No extractable text found in the PDF. Try using OCR on the PDF first.');
      }

      const finalMarkdown = markdownText.trim();
      const finalTxt = markdownToPlainText(finalMarkdown);
      const markdownBlobResult = new Blob([finalMarkdown], { type: 'text/markdown;charset=utf-8' });
      const txtBlobResult = new Blob([finalTxt], { type: 'text/plain;charset=utf-8' });

      setMarkdownBlob(markdownBlobResult);
      setTxtBlob(txtBlobResult);
      setMarkdownContent(finalMarkdown);
      setHtmlContent(await marked.parse(finalMarkdown));

      setProgress(65);
      setProgressMessage('Converting PDF to DOCX...');

      try {
        const docxOutput = await pdfToDocx(
          file.file,
          {},
          (prog, message) => {
            if (!cancelledRef.current) {
              setProgress(65 + Math.round((prog / 100) * 35));
              setProgressMessage(message || 'Converting to DOCX...');
            }
          }
        );

        if (cancelledRef.current) {
          setStatus('idle');
          return;
        }

        if (docxOutput.success && docxOutput.result instanceof Blob) {
          setDocxBlob(docxOutput.result);
        } else {
          setDocxError(docxOutput.error?.message || 'DOCX conversion failed.');
        }
      } catch (err) {
        setDocxError(err instanceof Error ? err.message : 'DOCX conversion failed.');
      }

      setProgress(100);
      setProgressMessage('Conversion complete.');
      setStatus('complete');
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : t('errors.unexpectedError') || 'An unexpected error occurred.');
        setStatus('error');
        setProgress(100);
      }
    }
  }, [file, includePageNumbers, pageRange, preserveLineBreaks, t]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isProcessing = status === 'processing' || status === 'uploading';
  const canConvert = file && !isProcessing;

  return (
    <div className={`space-y-8 ${className}`.trim()}>
      <FileUploader
        accept={['application/pdf', '.pdf']}
        multiple={false}
        maxFiles={1}
        onFilesSelected={handleFilesSelected}
        onError={handleUploadError}
        disabled={isProcessing}
        label={tTools('pdfConverter.uploadLabel') || 'Upload PDF'}
        description={tTools('pdfConverter.uploadDescription') || 'Drop a PDF file here or click to browse.'}
      />

      {error && (
        <div
          className="p-4 rounded-xl bg-red-50/50 border border-red-200 text-red-700 flex items-start gap-3 animate-in fade-in slide-in-from-top-2"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {file && (
        <Card variant="outlined" size="lg" className="glass-card">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[hsl(var(--color-primary)/0.1)] flex items-center justify-center text-[hsl(var(--color-primary))]">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <p className="font-semibold text-[hsl(var(--color-foreground))]">{file.file.name}</p>
                <p className="text-sm text-[hsl(var(--color-muted-foreground))]">{formatSize(file.file.size)}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveFile}
              disabled={isProcessing}
              className="text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-red-50"
            >
              <Trash2 className="w-5 h-5" />
              <span className="sr-only">{t('buttons.remove') || 'Remove'}</span>
            </Button>
          </div>
        </Card>
      )}

      {file && !isProcessing && status !== 'complete' && (
        <Card variant="outlined" size="lg" className="glass-card">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[hsl(var(--color-foreground))]">
              <Settings2 className="w-5 h-5" />
              <h3 className="font-semibold">Conversion Options</h3>
            </div>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex items-center gap-3 text-sm text-[hsl(var(--color-foreground))]">
                  <input
                    type="checkbox"
                    checked={includePageNumbers}
                    onChange={(e) => setIncludePageNumbers(e.target.checked)}
                    className="h-4 w-4 rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-primary))] focus:ring-[hsl(var(--color-primary))]"
                  />
                  Include page numbers
                </label>
                <label className="flex items-center gap-3 text-sm text-[hsl(var(--color-foreground))]">
                  <input
                    type="checkbox"
                    checked={preserveLineBreaks}
                    onChange={(e) => setPreserveLineBreaks(e.target.checked)}
                    className="h-4 w-4 rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-primary))] focus:ring-[hsl(var(--color-primary))]"
                  />
                  Preserve line breaks
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--color-foreground))]">Page Range</label>
                <input
                  type="text"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder="e.g., 1-3, 5, 7"
                  className="w-full px-3 py-2 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] placeholder:text-[hsl(var(--color-muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary))]"
                />
                <p className="mt-2 text-xs text-[hsl(var(--color-muted-foreground))]">Leave empty to convert all pages.</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {isProcessing && (
        <ProcessingProgress
          progress={progress}
          status={status}
          message={progressMessage}
          onCancel={handleCancel}
          showPercentage
        />
      )}

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button
          variant="primary"
          size="lg"
          onClick={handleConvert}
          disabled={!canConvert}
          loading={isProcessing}
          className="min-w-[200px] shadow-lg hover:shadow-primary/25 transition-all hover:-translate-y-0.5"
        >
          <RefreshCw className="w-5 h-5 mr-2" />
          {isProcessing ? 'Processing...' : 'Convert PDF'}
        </Button>

        {markdownBlob && (
          <DownloadButton
            file={markdownBlob}
            filename={`${file?.file.name.replace(/\.pdf$/i, '')}.md`}
            variant="secondary"
            size="lg"
            showFileSize
            className="min-w-[160px] shadow-lg transition-all hover:-translate-y-0.5"
            label="Download Markdown"
          />
        )}

        {txtBlob && (
          <DownloadButton
            file={txtBlob}
            filename={`${file?.file.name.replace(/\.pdf$/i, '')}.txt`}
            variant="secondary"
            size="lg"
            showFileSize
            className="min-w-[160px] shadow-lg transition-all hover:-translate-y-0.5"
            label="Download Text"
          />
        )}

        {docxBlob && (
          <DownloadButton
            file={docxBlob}
            filename={`${file?.file.name.replace(/\.pdf$/i, '')}.docx`}
            variant="secondary"
            size="lg"
            showFileSize
            className="min-w-[160px] shadow-lg transition-all hover:-translate-y-0.5"
            label="Download Word"
          />
        )}
      </div>

      {status === 'complete' && (
        <div className="p-6 rounded-2xl bg-green-50/50 border border-green-200 text-green-700 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Conversion completed</h3>
          <p className="text-green-800/80 max-w-xl mx-auto">
            Your PDF has been converted to Markdown and text. A Word document export is also generated if available.
          </p>
          {ocrFallback && (
            <p className="mt-3 text-sm text-[hsl(var(--color-muted-foreground))]">OCR fallback was used because the PDF did not contain extractable text.</p>
          )}
          {docxError && (
            <p className="mt-3 text-sm text-amber-700">DOCX export failed: {docxError}</p>
          )}
        </div>
      )}

      {activeTab && markdownContent && (
        <Card variant="outlined" size="lg" className="glass-card">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={activeTab === 'preview' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('preview')}
              >
                Preview
              </Button>
              <Button
                variant={activeTab === 'source' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('source')}
              >
                Markdown
              </Button>
              <Button
                variant={activeTab === 'text' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('text')}
              >
                Plain Text
              </Button>
            </div>

            <div className="border border-[hsl(var(--color-border))] rounded-2xl overflow-hidden bg-[hsl(var(--color-background))] p-4">
              {activeTab === 'preview' && (
                <div
                  className="prose prose-slate max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(htmlContent) }}
                />
              )}

              {activeTab === 'source' && (
                <pre className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--color-foreground))]">{markdownContent}</pre>
              )}

              {activeTab === 'text' && (
                <pre className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--color-foreground))]">{markdownToPlainText(markdownContent)}</pre>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
