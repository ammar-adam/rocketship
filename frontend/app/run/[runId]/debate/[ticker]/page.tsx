'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonCard } from '@/components/ui/Skeleton';
import styles from './detail.module.css';

// Generic agent output - handles both parsed JSON and raw string fallback
interface AgentOutput {
  agent?: string;
  thesis?: string;
  raw?: string;
  parsed?: unknown;
  parse_error?: string;
  error?: string;
  key_points?: Array<{ claim: string; evidence: string; numbers?: string; source: string }>;
  trend_map?: Array<{ trend: string; why_it_matters: string; company_link: string; evidence: string }>;
  risks?: Array<{ risk: string; why: string; monitoring_metric: string }>;
  catalysts?: Array<{ catalyst: string; timeframe: string; measurable_signal: string }>;
  what_changes_my_mind?: Array<{ condition: string; metric_to_watch: string }>;
  rebuttals_to_bear?: string[];
  rebuttals_to_bull?: string[];
  verdict?: string;
  confidence?: number;
  key_evidence?: string[];
}

interface RegimeOutput {
  agent?: string;
  thesis?: string;
  raw?: string;
  parsed?: unknown;
  parse_error?: string;
  error?: string;
  regime_classification?: string;
  supporting_signals?: Array<{ signal: string; reading: string; interpretation: string; source?: string }>;
  sector_positioning?: string;
  correlation_regime?: string;
  trend_map?: Array<{ trend: string; regime_impact: string; evidence: string }>;
  recommendation?: string;
  confidence?: number;
}

interface ValueOutput {
  agent?: string;
  thesis?: string;
  raw?: string;
  parsed?: unknown;
  parse_error?: string;
  error?: string;
  flow_assessment?: string;
  volume_signals?: Array<{ signal: string; value: string; interpretation: string; source?: string }>;
  price_target?: { low: number; mid: number; high: number; assumptions: string };
  margin_of_safety?: string;
  recommendation?: string;
  verdict?: string;
  confidence?: number;
  institutional_activity?: string;
  liquidity_assessment?: string;
  trend_map?: Array<{ trend: string; implication: string; evidence: string }>;
}

interface JudgeOutput {
  verdict?: string;
  confidence?: number;
  reasoning?: string;
  raw?: string;
  parsed?: unknown;
  parse_error?: string;
  error?: string;
  agreed_with?: {
    bull?: string[];
    bear?: string[];
    regime?: string[];
    volume?: string[];
    value?: string[];
  };
  rejected?: {
    bull?: string[];
    bear?: string[];
    regime?: string[];
    volume?: string[];
    value?: string[];
  };
  key_disagreements?: Array<{ topic: string; bull: string; bear: string; judge_resolution: string }>;
  decision_triggers?: Array<{ trigger: string; metric: string; threshold: string; would_change_to: string }>;
  where_agents_disagreed_most?: string[];
  rocket_score_rank_review?: string;
  tags?: string[];
  sources_used?: Array<{ type: string; refs: string[] }>;
}

interface NewsArticle {
  id: string;
  title: string;
  source: string;
  date: string;
  summary: string;
}

interface DebateData {
  ticker: string;
  rank?: number;
  rocket_score?: number;
  selection_group?: string;
  inputs?: {
    metrics?: Record<string, unknown>;
    news?: { articles?: NewsArticle[]; error?: string };
  };
  agents: {
    bull?: AgentOutput;
    bear?: AgentOutput;
    regime?: RegimeOutput;
    value?: ValueOutput;
    volume?: ValueOutput; // Legacy support
  };
  judge?: JudgeOutput;
  final?: { verdict: string; confidence: number; reasons: string[] };
  cross_exam?: Array<{
    type: string;
    critique: string;
    timestamp: string;
  }>;
  warnings?: string[];
  data_sources?: string[];
}

export default function DebateDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const ticker = params.ticker as string;

  const [data, setData] = useState<DebateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crossExamLoading, setCrossExamLoading] = useState(false);
  const [crossExamError, setCrossExamError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      let completed = false;
      const timeoutId = setTimeout(() => {
        if (!completed && !cancelled) {
          setLoading(false);
          setError('Request timed out');
        }
      }, 10000);

      try {
        const url = `/api/runs/${runId}/debate/${ticker}.json`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error('Debate data not found');
        }
        const debateData = await res.json();
        if (!cancelled) {
          setData(debateData);
        }
        completed = true;
      } catch (e) {
        if (!cancelled) {
          const errorMsg = e instanceof Error ? e.message : 'Failed to load debate';
          setError(errorMsg);
        }
        completed = true;
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchData();

    return () => {
      cancelled = true;
    };
  }, [runId, ticker]);

  const handleCrossExam = async (type: 'bull_critiques_bear' | 'bear_critiques_bull') => {
    setCrossExamLoading(true);
    setCrossExamError('');

    const from = type === 'bull_critiques_bear' ? 'bull' : 'bear';
    const target = type === 'bull_critiques_bear' ? 'bear' : 'bull';

    try {
      const res = await fetch(`/api/run/${runId}/debate/${encodeURIComponent(ticker)}/cross-exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, target })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || `Cross-exam failed: ${res.status}`);
      }
      const refreshRes = await fetch(`/api/runs/${runId}/debate/${encodeURIComponent(ticker)}.json`);
      if (refreshRes.ok) {
        setData(await refreshRes.json());
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Cross-exam failed';
      setCrossExamError(errMsg);
    } finally {
      setCrossExamLoading(false);
    }
  };


  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <SkeletonCard />
          <div className={styles.agentGrid}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.page}>
          <div className={styles.container}>
            <Card variant="elevated" padding="lg">
              <CardContent>
                <div className={styles.noDebateContainer}>
                  <h2 className={styles.noDebateTitle}>No Debate Available for {ticker}</h2>
                <p className={styles.noDebateDesc}>
                  Debate data hasn&apos;t been generated yet for this run.
                  Run the full debate to analyze all selected stocks.
                </p>

                <Link href={`/run/${runId}/debate/loading`} className={styles.requestDebateBtn}>
                  Run Full Debate
                </Link>

                <Link href={`/run/${runId}/debate`} className={styles.backLink}>
                  &larr; Back to Debate Dashboard
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const judge = data.judge;
  const bull = data.agents?.bull;
  const bear = data.agents?.bear;
  const regime = data.agents?.regime;
  // Support both 'value' and legacy 'volume' agent
  const value = data.agents?.value || data.agents?.volume;

  // News articles from inputs
  const newsArticles = data.inputs?.news?.articles || [];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <Link href={`/run/${runId}`}>Dashboard</Link>
          <span>/</span>
          <Link href={`/run/${runId}/debate`}>Debate</Link>
          <span>/</span>
          <span>{ticker}</span>
        </nav>

        {/* Header */}
        <header className={styles.header}>
          <h1 className={styles.ticker}>{ticker}</h1>
          {judge && (
            <Badge
              variant={judge.verdict === 'BUY' ? 'buy' : judge.verdict === 'HOLD' ? 'hold' : 'sell'}
              size="md"
            >
              {judge.verdict} ({judge.confidence}%)
            </Badge>
          )}
          {data.rank && (
            <Badge variant="default" size="sm">Rank #{data.rank}</Badge>
          )}
          {data.selection_group && (
            <Badge variant="default" size="sm">{data.selection_group}</Badge>
          )}
        </header>

        {/* Warnings */}
        {data.warnings && data.warnings.length > 0 && (
          <div className={styles.warnings}>
            {data.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        {/* Judge Verdict (Full Width) */}
        {judge && (
          <Card variant="elevated" className={styles.judgeCard}>
            <CardHeader>
              <CardTitle>Final Verdict: {judge.verdict}</CardTitle>
            </CardHeader>
            <CardContent>
              {judge.reasoning ? (
                <p className={styles.judgeSummary}>{judge.reasoning}</p>
              ) : judge.raw ? (
                <pre className={styles.rawOutput}>{judge.raw}</pre>
              ) : (
                <p className={styles.noData}>No judge reasoning available</p>
              )}

              {judge.where_agents_disagreed_most && judge.where_agents_disagreed_most.length > 0 && (
                <div className={styles.section}>
                  <h4>Where agents disagreed most</h4>
                  <ul>
                    {judge.where_agents_disagreed_most.map((item, i) => (
                      <li key={`disagree-${i}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {judge.rocket_score_rank_review && (
                <div className={styles.section}>
                  <h4>Why RocketScore ranking did or did not hold up</h4>
                  <p>{judge.rocket_score_rank_review}</p>
                </div>
              )}

              {judge.tags && judge.tags.length > 0 && (
                <div className={styles.judgeTags}>
                  {judge.tags.map((tag, i) => (
                    <Badge key={i} variant="default" size="sm">{tag}</Badge>
                  ))}
                </div>
              )}

              {judge.key_disagreements && judge.key_disagreements.length > 0 && (
                <div className={styles.section}>
                  <h4>Key Disagreements</h4>
                  <div className={styles.disagreements}>
                    {judge.key_disagreements.map((d, i) => (
                      <div key={i} className={styles.disagreement}>
                        <strong>{d.topic}</strong>
                        <p><span className={styles.bullLabel}>Bull:</span> {d.bull}</p>
                        <p><span className={styles.bearLabel}>Bear:</span> {d.bear}</p>
                        <p><span className={styles.judgeLabel}>Resolution:</span> {d.judge_resolution}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.judgeDetails}>
                <div className={styles.section}>
                  <h4>Agreed With</h4>
                  {judge.agreed_with && (
                    <ul>
                      {judge.agreed_with.bull?.map((a, i) => <li key={`b${i}`}><strong>Bull:</strong> {a}</li>)}
                      {judge.agreed_with.bear?.map((a, i) => <li key={`r${i}`}><strong>Bear:</strong> {a}</li>)}
                      {judge.agreed_with.regime?.map((a, i) => <li key={`m${i}`}><strong>Regime:</strong> {a}</li>)}
                      {(judge.agreed_with.volume || judge.agreed_with.value)?.map((a, i) => <li key={`v${i}`}><strong>Value:</strong> {a}</li>)}
                    </ul>
                  )}
                </div>

                <div className={styles.section}>
                  <h4>Rejected</h4>
                  {judge.rejected && (
                    <ul>
                      {judge.rejected.bull?.map((r, i) => <li key={`b${i}`}><strong>Bull:</strong> {r}</li>)}
                      {judge.rejected.bear?.map((r, i) => <li key={`r${i}`}><strong>Bear:</strong> {r}</li>)}
                      {judge.rejected.regime?.map((r, i) => <li key={`m${i}`}><strong>Regime:</strong> {r}</li>)}
                      {(judge.rejected.volume || judge.rejected.value)?.map((r, i) => <li key={`v${i}`}><strong>Value:</strong> {r}</li>)}
                    </ul>
                  )}
                </div>
              </div>

              {judge.decision_triggers && judge.decision_triggers.length > 0 && (
                <div className={styles.section}>
                  <h4>Decision Triggers</h4>
                  <ul>
                    {judge.decision_triggers.map((t, i) => (
                      <li key={i}>
                        If <strong>{t.trigger}</strong> ({t.metric} {t.threshold}) &rarr;{' '}
                        <Badge
                          variant={t.would_change_to === 'BUY' ? 'buy' : t.would_change_to === 'HOLD' ? 'hold' : 'sell'}
                          size="sm"
                        >
                          {t.would_change_to}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {judge.sources_used && judge.sources_used.length > 0 && (
                <Collapsible title="Sources Used">
                  <ul className={styles.sourcesList}>
                    {judge.sources_used.map((s, i) => (
                      <li key={i}>
                        <strong>{s.type}:</strong> {s.refs.join(', ')}
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        )}

        {/* Agent Grid - now 5 agents: bull, bear, regime, value, (judge is above) */}
        <div className={styles.agentGrid}>
          <AgentCard
            title="Bull Analyst"
            variant="buy"
            agent={bull}
          />

          <AgentCard
            title="Bear Analyst"
            variant="wait"
            agent={bear}
          />

          <AgentCard
            title="Regime Analyst"
            variant="default"
            agent={regime}
            isRegime
          />

          <AgentCard
            title="Value Analyst"
            variant="default"
            agent={value}
            isValue
          />
        </div>

        {/* News Context */}
        {newsArticles.length > 0 && (
          <Collapsible title={`News Context (${newsArticles.length} articles)`} defaultOpen={false}>
            <div className={styles.newsGrid}>
              {newsArticles.map((article, i) => (
                <div key={i} className={styles.newsItem}>
                  <span className={styles.newsId}>[{article.id}]</span>
                  <span className={styles.newsDate}>{article.date}</span>
                  <span className={styles.newsSource}>{article.source}</span>
                  <p className={styles.newsTitle}>{article.title}</p>
                  {article.summary && <p className={styles.newsSummary}>{article.summary}</p>}
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Cross Examination */}
        <Card className={styles.crossExamCard}>
          <CardHeader>
            <CardTitle>Agent Interaction</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={styles.crossExamButtons}>
              <button
                className={styles.crossExamBtn}
                onClick={() => handleCrossExam('bull_critiques_bear')}
                disabled={crossExamLoading}
              >
                {crossExamLoading ? 'Running...' : 'Ask Bull to Critique Bear'}
              </button>
              <button
                className={styles.crossExamBtn}
                onClick={() => handleCrossExam('bear_critiques_bull')}
                disabled={crossExamLoading}
              >
                {crossExamLoading ? 'Running...' : 'Ask Bear to Critique Bull'}
              </button>
            </div>

            {crossExamError && (
              <p className={styles.crossExamError}>{crossExamError}</p>
            )}

            {data.cross_exam && data.cross_exam.length > 0 && (
              <div className={styles.crossExamResults}>
                {data.cross_exam.map((exam, i) => (
                  <div key={i} className={styles.crossExamItem}>
                    <Badge variant={exam.type.includes('bull') ? 'buy' : 'wait'} size="sm">
                      {exam.type.includes('bull') ? 'Bull \u2192 Bear' : 'Bear \u2192 Bull'}
                    </Badge>
                    <p>{exam.critique}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Data Sources */}
        <Collapsible title="Data Sources">
          <ul className={styles.sourcesList}>
            {data.data_sources?.map((s, i) => <li key={i}>{s}</li>) || <li>No sources listed</li>}
          </ul>
        </Collapsible>

        {/* Raw JSON */}
        <Collapsible title="Raw JSON">
          <pre className={styles.json}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </Collapsible>
      </div>
    </div>
  );
}

interface AgentCardProps {
  title: string;
  variant: 'buy' | 'wait' | 'default';
  agent?: AgentOutput | RegimeOutput | ValueOutput;
  isRegime?: boolean;
  isValue?: boolean;
}

function AgentCard({ title, variant, agent, isRegime, isValue }: AgentCardProps) {
  if (!agent) {
    return (
      <Card variant="bordered" className={styles.agentCard}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.noData}>Missing agent output</p>
        </CardContent>
      </Card>
    );
  }

  // If agent has error or only raw text, show raw fallback
  const parseError = 'parse_error' in agent ? agent.parse_error : undefined;
  const hasStructuredContent = agent.thesis && !agent.error && !parseError;
  const rawText = (agent as AgentOutput).raw;

  const borderClass = variant === 'buy' ? styles.borderBuy : variant === 'wait' ? styles.borderWait : '';

  // If no structured content but we have raw, show it
  if (!hasStructuredContent && rawText) {
    return (
      <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {agent.error && <Badge variant="danger" size="sm">Error</Badge>}
        </CardHeader>
        <CardContent>
          <p className={styles.noData}>Structured parse failed. Raw output:</p>
          <pre className={styles.rawOutput}>{rawText}</pre>
        </CardContent>
      </Card>
    );
  }

  if (isRegime) {
    const r = agent as RegimeOutput;
    return (
      <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {r.regime_classification && <Badge variant="default" size="sm">{r.regime_classification}</Badge>}
          {r.confidence != null && <Badge variant="default" size="sm">{r.confidence}%</Badge>}
        </CardHeader>
        <CardContent>
          <p className={styles.summary}>{r.thesis}</p>

          {r.supporting_signals && r.supporting_signals.length > 0 && (
            <Collapsible title={`Signals (${r.supporting_signals.length})`}>
              <ul className={styles.list}>
                {r.supporting_signals.map((s, i) => (
                  <li key={i}><strong>{s.signal}:</strong> {s.reading} &ndash; {s.interpretation}</li>
                ))}
              </ul>
            </Collapsible>
          )}

          {r.trend_map && r.trend_map.length > 0 && (
            <Collapsible title={`Trend Analysis (${r.trend_map.length})`}>
              <ul className={styles.list}>
                {r.trend_map.map((t, i) => (
                  <li key={i}><strong>{t.trend}:</strong> {t.regime_impact} &ndash; <em>{t.evidence}</em></li>
                ))}
              </ul>
            </Collapsible>
          )}

          {r.sector_positioning && <p className={styles.sectorContext}><strong>Sector Positioning:</strong> {r.sector_positioning}</p>}
          {r.correlation_regime && <p><strong>Correlation Regime:</strong> {r.correlation_regime}</p>}
          {r.recommendation && <p className={styles.recommendation}><strong>Recommendation:</strong> {r.recommendation}</p>}

          {r.raw && (
            <Collapsible title="Raw Output">
              <pre className={styles.rawOutput}>{r.raw}</pre>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isValue) {
    const v = agent as ValueOutput;
    return (
      <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {v.flow_assessment && <Badge variant="default" size="sm">{v.flow_assessment}</Badge>}
          {v.margin_of_safety && <Badge variant="default" size="sm">MoS: {v.margin_of_safety}</Badge>}
          {v.confidence != null && <Badge variant="default" size="sm">{v.confidence}%</Badge>}
        </CardHeader>
        <CardContent>
          <p className={styles.summary}>{v.thesis}</p>

          {v.price_target && (
            <div className={styles.section}>
              <h4>Price Target Range</h4>
              <p>
                Low: ${v.price_target.low} | Mid: ${v.price_target.mid} | High: ${v.price_target.high}
              </p>
              {v.price_target.assumptions && <p><em>{v.price_target.assumptions}</em></p>}
            </div>
          )}

          {v.volume_signals && v.volume_signals.length > 0 && (
            <Collapsible title={`Valuation Signals (${v.volume_signals.length})`}>
              <ul className={styles.list}>
                {v.volume_signals.map((s, i) => (
                  <li key={i}><strong>{s.signal}:</strong> {s.value} &ndash; {s.interpretation}</li>
                ))}
              </ul>
            </Collapsible>
          )}

          {v.trend_map && v.trend_map.length > 0 && (
            <Collapsible title={`Value Trends (${v.trend_map.length})`}>
              <ul className={styles.list}>
                {v.trend_map.map((t, i) => (
                  <li key={i}><strong>{t.trend}:</strong> {t.implication} &ndash; <em>{t.evidence}</em></li>
                ))}
              </ul>
            </Collapsible>
          )}

          {v.institutional_activity && <p className={styles.institutional}><strong>Institutional Activity:</strong> {v.institutional_activity}</p>}
          {v.liquidity_assessment && <p><strong>Liquidity:</strong> {v.liquidity_assessment}</p>}
          {v.recommendation && <p className={styles.recommendation}><strong>Recommendation:</strong> {v.recommendation}</p>}

          {v.raw && (
            <Collapsible title="Raw Output">
              <pre className={styles.rawOutput}>{v.raw}</pre>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    );
  }

  // Bull/Bear agent
  const a = agent as AgentOutput;
  return (
    <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {a.verdict && <Badge variant={a.verdict === 'ENTER' || a.verdict === 'BUY' ? 'buy' : a.verdict === 'HOLD' ? 'hold' : 'sell'} size="sm">{a.verdict}</Badge>}
        {a.confidence != null && <Badge variant="default" size="sm">{a.confidence}%</Badge>}
      </CardHeader>
      <CardContent>
        <Collapsible title="Thesis" defaultOpen={true}>
          <p className={styles.thesis}>{a.thesis}</p>
        </Collapsible>

        {a.key_points && a.key_points.length > 0 && (
          <Collapsible title={`Key Points (${a.key_points.length})`}>
            <table className={styles.agentTable}>
              <thead>
                <tr><th>Claim</th><th>Evidence</th><th>Source</th></tr>
              </thead>
              <tbody>
                {a.key_points.map((p, i) => (
                  <tr key={i}>
                    <td>{p.claim}</td>
                    <td>{p.evidence} {p.numbers && <strong>({p.numbers})</strong>}</td>
                    <td><Badge variant="default" size="sm">{p.source}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Collapsible>
        )}

        {a.key_evidence && a.key_evidence.length > 0 && (
          <Collapsible title="Key Evidence">
            <ul className={styles.list}>
              {a.key_evidence.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </Collapsible>
        )}

        {a.trend_map && a.trend_map.length > 0 && (
          <Collapsible title={`Trend Analysis (${a.trend_map.length})`}>
            <ul className={styles.list}>
              {a.trend_map.map((t, i) => (
                <li key={i}>
                  <strong>{t.trend}</strong>: {t.why_it_matters}
                  <br /><em>Company Link:</em> {t.company_link}
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        {a.catalysts && a.catalysts.length > 0 && (
          <Collapsible title={`Catalysts (${a.catalysts.length})`}>
            <ul className={styles.list}>
              {a.catalysts.map((c, i) => (
                <li key={i}><strong>{c.timeframe}:</strong> {c.catalyst} &ndash; <em>{c.measurable_signal}</em></li>
              ))}
            </ul>
          </Collapsible>
        )}

        {a.risks && a.risks.length > 0 && (
          <Collapsible title={`Risks (${a.risks.length})`}>
            <ul className={styles.list}>
              {a.risks.map((r, i) => (
                <li key={i}><strong>{r.risk}</strong>: {r.why} &ndash; <em>Watch: {r.monitoring_metric}</em></li>
              ))}
            </ul>
          </Collapsible>
        )}

        {a.what_changes_my_mind && a.what_changes_my_mind.length > 0 && (
          <Collapsible title="What Would Change My Mind">
            <ul className={styles.list}>
              {a.what_changes_my_mind.map((w, i) => (
                <li key={i}>{w.condition} &ndash; <em>Watch: {w.metric_to_watch}</em></li>
              ))}
            </ul>
          </Collapsible>
        )}

        {a.rebuttals_to_bear && a.rebuttals_to_bear.length > 0 && (
          <Collapsible title="Rebuttals to Bear">
            <ul className={styles.list}>
              {a.rebuttals_to_bear.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </Collapsible>
        )}
        {a.rebuttals_to_bull && a.rebuttals_to_bull.length > 0 && (
          <Collapsible title="Rebuttals to Bull">
            <ul className={styles.list}>
              {a.rebuttals_to_bull.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </Collapsible>
        )}

        {a.raw && (
          <Collapsible title="Raw Output">
            <pre className={styles.rawOutput}>{a.raw}</pre>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
