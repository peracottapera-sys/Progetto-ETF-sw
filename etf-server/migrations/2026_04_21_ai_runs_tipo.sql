-- ════════════════════════════════════════════════════════════════════════════
-- Migrazione: ai_runs → colonna `tipo` per distinguere creazioni da analisi
-- Data: 2026-04-21
-- ════════════════════════════════════════════════════════════════════════════
--
-- Aggiunge colonna `tipo` alla tabella ai_runs per supportare due categorie
-- di run AI:
--   - 'creazione' : portafoglio generato ex novo via CreaPortafoglioModal
--   - 'analisi'   : revisione di un portafoglio esistente via AIModal
--
-- I record esistenti (96 al momento della migrazione) ricevono automaticamente
-- tipo='creazione' perché fino ad oggi solo la creazione produceva ai_runs.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Aggiungi colonna con default 'creazione' (popola anche le righe esistenti)
ALTER TABLE ai_runs
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'creazione';

-- 2. Vincolo: solo i due valori ammessi
ALTER TABLE ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_tipo_check;
ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_tipo_check CHECK (tipo IN ('creazione', 'analisi'));

-- 3. Indice per filtri frequenti (AiRuns pagina + Dashboard)
CREATE INDEX IF NOT EXISTS idx_ai_runs_tipo ON ai_runs(tipo);
CREATE INDEX IF NOT EXISTS idx_ai_runs_portfolio_tipo ON ai_runs(portfolio_id, tipo, created_at DESC);

COMMIT;

-- Verifica
-- SELECT tipo, COUNT(*) FROM ai_runs GROUP BY tipo;
