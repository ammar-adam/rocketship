'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonCard } from '@/components/ui/Skeleton';
import styles from './detail.module.css';

interface AgentOutput {
  executive_summary?: string;
  core_thesis?: string;
  metrics_table?: Array<{ metric: string; value: string; interpretation: string }>;
  catalysts?: Array<{ event: string; timeframe: string; impact: string }>;
  risks?: Array<{ risk: string; probability: string; mitigation: string }>;
  what_would_change_my_mind?: Array<{ trigger: string; threshold: string }>;
  time_horizon?: string;
  positioning_notes?: string;
  sources?: string[];
}

interface RegimeOutput {
  executive_summary?: string;
  regime_classification?: string;
  supporting_signals?: Array<{ signal: string; reading: string; interpretation: string }>;
  sector_positioning?: string;
  recommendation?: string;
}

interface VolumeOutput {
  executive_summary?: string;
  flow_assessment?: string;
  volume_signals?: Array<{ signal: string; value: string; interpretation: string }>;
  institutional_activity?: string;
  recommendation?: string;
}

interface JudgeOutput {
  verdict?: string;
  confidence?: number;
  executive_summary?: string;
  agreements?: {
    bull?: string[];
    bear?: string[];
    regime?: string[];
    volume?: string[];
  };
  rejections?: {
    bull?: string[];
    bear?: string[];
    regime?: string[];
    volume?: string[];
  };
  key_metrics_driving_decision?: Array<{ metric: string; value: string; weight: string }>;
  decision_triggers?: Array<{ condition: string; new_verdict: string }>;
  position_sizing?: string;
  time_horizon?: string;
}

interface DebateData {
  ticker: string;
  agents: {
    bull?: AgentOutput;
    bear?: AgentOutput;
    regime?: RegimeOutput;
    volume?: VolumeOutput;
  };
  judge?: JudgeOutput;
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
  
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/runs/${runId}/debate/${ticker}.json`);
        if (!res.ok) {
          throw new Error('Debate data not found');
        }
        const debateData = await res.json();
        setData(debateData);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load debate');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [runId, ticker]);
  
  const handleCrossExam = async (type: 'bull_critiques_bear' | 'bear_critiques_bull') => {
    setCrossExamLoading(true);
    try {
      const res = await fetch(`/api/run/${runId}/debate/${ticker}/cross-exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      
      if (res.ok) {
        const result = await res.json();
        // Refresh data
        const refreshRes = await fetch(`/api/runs/${runId}/debate/${ticker}.json`);
        if (refreshRes.ok) {
          setData(await refreshRes.json());
        }
      }
    } catch (e) {
      // Silently fail
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
          <Card>
            <CardContent>
              <p className={styles.error}>{error || 'No debate data available'}</p>
              <Link href={`/run/${runId}/debate`} className={styles.backLink}>
                ← Back to Debate Dashboard
              </Link>
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
  const volume = data.agents?.volume;
  
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
              variant={judge.verdict === 'BUY' ? 'buy' : judge.verdict === 'HOLD' ? 'hold' : 'wait'}
              size="md"
            >
              {judge.verdict} ({judge.confidence}%)
            </Badge>
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
              <p className={styles.judgeSummary}>{judge.executive_summary}</p>
              
              {judge.key_metrics_driving_decision && judge.key_metrics_driving_decision.length > 0 && (
                <div className={styles.section}>
                  <h4>Key Metrics Driving Decision</h4>
                  <table className={styles.metricsTable}>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {judge.key_metrics_driving_decision.map((m, i) => (
                        <tr key={i}>
                          <td>{m.metric}</td>
                          <td>{m.value}</td>
                          <td>{m.weight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              
              <div className={styles.judgeDetails}>
                <div className={styles.section}>
                  <h4>Agreed With</h4>
                  {judge.agreements && (
                    <ul>
                      {judge.agreements.bull?.map((a, i) => <li key={`b${i}`}><strong>Bull:</strong> {a}</li>)}
                      {judge.agreements.bear?.map((a, i) => <li key={`r${i}`}><strong>Bear:</strong> {a}</li>)}
                      {judge.agreements.regime?.map((a, i) => <li key={`m${i}`}><strong>Regime:</strong> {a}</li>)}
                      {judge.agreements.volume?.map((a, i) => <li key={`v${i}`}><strong>Volume:</strong> {a}</li>)}
                    </ul>
                  )}
                </div>
                
                <div className={styles.section}>
                  <h4>Rejected</h4>
                  {judge.rejections && (
                    <ul>
                      {judge.rejections.bull?.map((r, i) => <li key={`b${i}`}><strong>Bull:</strong> {r}</li>)}
                      {judge.rejections.bear?.map((r, i) => <li key={`r${i}`}><strong>Bear:</strong> {r}</li>)}
                      {judge.rejections.regime?.map((r, i) => <li key={`m${i}`}><strong>Regime:</strong> {r}</li>)}
                      {judge.rejections.volume?.map((r, i) => <li key={`v${i}`}><strong>Volume:</strong> {r}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              
              {judge.decision_triggers && judge.decision_triggers.length > 0 && (
                <div className={styles.section}>
                  <h4>Decision Triggers</h4>
                  <ul>
                    {judge.decision_triggers.map((t, i) => (
                      <li key={i}>If {t.condition} → {t.new_verdict}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className={styles.positionInfo}>
                <span><strong>Position Sizing:</strong> {judge.position_sizing || 'N/A'}</span>
                <span><strong>Time Horizon:</strong> {judge.time_horizon || 'N/A'}</span>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Agent Grid */}
        <div className={styles.agentGrid}>
          {/* Bull Agent */}
          <AgentCard
            title="Bull Analyst"
            variant="buy"
            agent={bull}
          />
          
          {/* Bear Agent */}
          <AgentCard
            title="Bear Analyst"
            variant="wait"
            agent={bear}
          />
          
          {/* Regime Agent */}
          <AgentCard
            title="Regime Analyst"
            variant="default"
            agent={regime}
            isRegime
          />
          
          {/* Volume Agent */}
          <AgentCard
            title="Volume Analyst"
            variant="default"
            agent={volume}
            isVolume
          />
        </div>
        
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
                Ask Bull to Critique Bear
              </button>
              <button 
                className={styles.crossExamBtn}
                onClick={() => handleCrossExam('bear_critiques_bull')}
                disabled={crossExamLoading}
              >
                Ask Bear to Critique Bull
              </button>
            </div>
            
            {data.cross_exam && data.cross_exam.length > 0 && (
              <div className={styles.crossExamResults}>
                {data.cross_exam.map((exam, i) => (
                  <div key={i} className={styles.crossExamItem}>
                    <Badge variant={exam.type.includes('bull') ? 'buy' : 'wait'} size="sm">
                      {exam.type.includes('bull') ? 'Bull → Bear' : 'Bear → Bull'}
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
  agent?: AgentOutput | RegimeOutput | VolumeOutput;
  isRegime?: boolean;
  isVolume?: boolean;
}

function AgentCard({ title, variant, agent, isRegime, isVolume }: AgentCardProps) {
  if (!agent) {
    return (
      <Card variant="bordered" className={styles.agentCard}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.noData}>No analysis available</p>
        </CardContent>
      </Card>
    );
  }
  
  const borderClass = variant === 'buy' ? styles.borderBuy : variant === 'wait' ? styles.borderWait : '';
  
  if (isRegime) {
    const r = agent as RegimeOutput;
    return (
      <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {r.regime_classification && <Badge variant="default" size="sm">{r.regime_classification}</Badge>}
        </CardHeader>
        <CardContent>
          <p className={styles.summary}>{r.executive_summary}</p>
          <Collapsible title="Signals">
            <ul className={styles.list}>
              {r.supporting_signals?.map((s, i) => (
                <li key={i}><strong>{s.signal}:</strong> {s.reading} – {s.interpretation}</li>
              ))}
            </ul>
          </Collapsible>
          <p className={styles.sectorContext}><strong>Sector:</strong> {r.sector_positioning}</p>
          <p className={styles.recommendation}><strong>Recommendation:</strong> {r.recommendation}</p>
        </CardContent>
      </Card>
    );
  }
  
  if (isVolume) {
    const v = agent as VolumeOutput;
    return (
      <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {v.flow_assessment && <Badge variant="default" size="sm">{v.flow_assessment}</Badge>}
        </CardHeader>
        <CardContent>
          <p className={styles.summary}>{v.executive_summary}</p>
          <Collapsible title="Volume Signals">
            <ul className={styles.list}>
              {v.volume_signals?.map((s, i) => (
                <li key={i}><strong>{s.signal}:</strong> {s.value} – {s.interpretation}</li>
              ))}
            </ul>
          </Collapsible>
          <p className={styles.institutional}><strong>Institutional:</strong> {v.institutional_activity}</p>
          <p className={styles.recommendation}><strong>Recommendation:</strong> {v.recommendation}</p>
        </CardContent>
      </Card>
    );
  }
  
  const a = agent as AgentOutput;
  return (
    <Card variant="bordered" className={`${styles.agentCard} ${borderClass}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={styles.summary}>{a.executive_summary}</p>
        
        <Collapsible title="Core Thesis" defaultOpen={false}>
          <p className={styles.thesis}>{a.core_thesis}</p>
        </Collapsible>
        
        {a.metrics_table && a.metrics_table.length > 0 && (
          <Collapsible title={`Metrics (${a.metrics_table.length})`}>
            <table className={styles.agentTable}>
              <thead>
                <tr><th>Metric</th><th>Value</th><th>Interpretation</th></tr>
              </thead>
              <tbody>
                {a.metrics_table.map((m, i) => (
                  <tr key={i}><td>{m.metric}</td><td>{m.value}</td><td>{m.interpretation}</td></tr>
                ))}
              </tbody>
            </table>
          </Collapsible>
        )}
        
        {a.catalysts && a.catalysts.length > 0 && (
          <Collapsible title={`Catalysts (${a.catalysts.length})`}>
            <ul className={styles.list}>
              {a.catalysts.map((c, i) => (
                <li key={i}><strong>{c.timeframe}:</strong> {c.event} – {c.impact}</li>
              ))}
            </ul>
          </Collapsible>
        )}
        
        {a.risks && a.risks.length > 0 && (
          <Collapsible title={`Risks (${a.risks.length})`}>
            <ul className={styles.list}>
              {a.risks.map((r, i) => (
                <li key={i}><strong>{r.risk}</strong> ({r.probability}) – {r.mitigation}</li>
              ))}
            </ul>
          </Collapsible>
        )}
        
        {a.what_would_change_my_mind && a.what_would_change_my_mind.length > 0 && (
          <Collapsible title="What Would Change My Mind">
            <ul className={styles.list}>
              {a.what_would_change_my_mind.map((w, i) => (
                <li key={i}>{w.trigger}: {w.threshold}</li>
              ))}
            </ul>
          </Collapsible>
        )}
        
        <div className={styles.agentMeta}>
          <span><strong>Time Horizon:</strong> {a.time_horizon || 'N/A'}</span>
        </div>
      </CardContent>
    </Card>
  );
}
