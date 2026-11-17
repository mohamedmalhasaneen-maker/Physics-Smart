import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Language } from '../types/physics';

interface ErrorBoundaryProps {
  lang?: Language;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Physics Smart UI Boundary]', error, info.componentStack);
  }

  handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      const ar = (this.props.lang || 'ar') === 'ar';
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl glass-card p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl glass-icon glass-icon-amber flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold">
              {ar ? 'تعذر عرض هذا القسم مؤقتًا' : 'Unable to display this section'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {ar
                ? 'تم الحفاظ على جميع بياناتك وتقدمك بأمان في الذاكرة المحلية. اضغط إعادة المحاولة لاستئناف العمل.'
                : 'Your data and study progress are safely preserved offline. Click retry to recover cleanly.'}
            </p>
            <button
              onClick={this.handleRecover}
              className="px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{ar ? 'إعادة المحاولة' : 'Recover Section'}</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
