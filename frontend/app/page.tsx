import Link from 'next/link';
import Button from '@/components/Button';

export default function WelcomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{
      backgroundColor: 'var(--color-bg-base)'
    }}>
      <div className="text-center" style={{
        maxWidth: 'var(--content-narrow)',
        padding: 'var(--space-8)'
      }}>
        <h1 style={{
          fontSize: 'var(--font-size-4xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-fg-primary)',
          marginBottom: 'var(--space-4)'
        }}>
          RocketShip
        </h1>
        
        <p style={{
          fontSize: 'var(--font-size-lg)',
          color: 'var(--color-fg-secondary)',
          marginBottom: 'var(--space-12)',
          lineHeight: 'var(--line-height-relaxed)'
        }}>
          Multi-agent stock discovery system
        </p>
        
        <Link href="/setup">
          <Button variant="primary">
            Start
          </Button>
        </Link>
      </div>
    </div>
  );
}
