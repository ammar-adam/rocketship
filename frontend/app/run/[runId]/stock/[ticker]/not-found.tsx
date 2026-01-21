import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Stock or Run Not Found
        </h1>
        <p className="text-muted mb-4">
          The requested stock or run does not exist.
        </p>
        <Link 
          href="/" 
          className="inline-block px-4 py-2 bg-accent text-white rounded hover:bg-accent-dark transition-colors"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
