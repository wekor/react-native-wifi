import { translate } from '@docusaurus/Translate';
import type { ReactNode } from 'react';

const Meta = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="api-meta">
    <span className="api-meta__label">{label}:</span>
    <span className="api-meta__value">{children}</span>
  </div>
);

export const Returns = ({ children }: { children: ReactNode }) => (
  <Meta label={translate({ id: 'api.returns', message: 'Returns' })}>{children}</Meta>
);

export const Errors = ({ children }: { children: ReactNode }) => (
  <Meta label={translate({ id: 'api.errors', message: 'Errors' })}>{children}</Meta>
);

export const Throws = ({ children }: { children: ReactNode }) => (
  <Meta label={translate({ id: 'api.throws', message: 'Throws' })}>{children}</Meta>
);

export const Type = ({ children }: { children: ReactNode }) => (
  <Meta label={translate({ id: 'api.type', message: 'Type' })}>{children}</Meta>
);

export const Default = ({ children }: { children: ReactNode }) => (
  <Meta label={translate({ id: 'api.default', message: 'Default' })}>{children}</Meta>
);

/** "(optional)" under a parameter or property name. */
export const Optional = () => (
  <span className="optional">{translate({ id: 'api.optional', message: '(optional)' })}</span>
);
