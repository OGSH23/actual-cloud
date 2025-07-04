import React, { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { type CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { tokens } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';

import { Link } from '@desktop-client/components/common/Link';

type SettingProps = {
  primaryAction?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
};

export const Setting = ({ primaryAction, style, children }: SettingProps) => {
  return (
    <View
      className={css([
        {
          backgroundColor: theme.pillBackground,
          alignSelf: 'flex-start',
          alignItems: 'flex-start',
          padding: 15,
          borderRadius: 4,
          border: '1px solid ' + theme.pillBorderDark,
          width: '100%',
        },
        style,
      ])}
    >
      <View
        style={{
          marginBottom: primaryAction ? 10 : 0,
          lineHeight: 1.5,
          gap: 10,
        }}
      >
        {children}
      </View>
      {primaryAction || null}
    </View>
  );
};

type AdvancedToggleProps = {
  children: ReactNode;
};

export const AdvancedToggle = ({ children }: AdvancedToggleProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [expanded, setExpanded] = useState(location.hash === '#advanced');

  return expanded ? (
    <View
      id="advanced"
      style={{
        gap: 20,
        alignItems: 'flex-start',
        marginBottom: 25,
        width: '100%',
      }}
      className={css({
        [`@media (min-width: ${tokens.breakpoint_small})`]: {
          width: 'auto',
        },
      })}
      innerRef={el => {
        if (el && location.hash === '#advanced') {
          el.scrollIntoView(true);
        }
      }}
    >
      <View style={{ fontSize: 20, fontWeight: 500, flexShrink: 0 }}>
        {t('Advanced Settings')}
      </View>
      {children}
    </View>
  ) : (
    <Link
      variant="text"
      onClick={() => setExpanded(true)}
      data-testid="advanced-settings"
      style={{
        flexShrink: 0,
        alignSelf: 'flex-start',
        color: theme.pageTextPositive,
        marginBottom: 25,
      }}
    >
      {t('Show advanced settings')}
    </Link>
  );
};
