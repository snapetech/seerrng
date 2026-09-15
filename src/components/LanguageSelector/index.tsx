import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import type { Language } from '@server/lib/settings';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import Select from 'react-select';
import useSWR from 'swr';

const messages = defineMessages('components.LanguageSelector', {
  originalLanguageDefault: 'All Languages',
  any: 'Any',
  languageServerDefault: 'Default ({language})',
});

type OptionType = {
  value: string;
  label: string;
  isFixed?: boolean;
};

interface LanguageSelectorProps {
  value?: string;
  setFieldValue: (property: string, value: string) => void;
  serverValue?: string;
  isUserSettings?: boolean;
  isDisabled?: boolean;
  fieldName?: string;
  compact?: boolean;
}

const LanguageSelector = ({
  value,
  setFieldValue,
  serverValue,
  isUserSettings = false,
  isDisabled,
  fieldName = 'originalLanguage',
  compact = false,
}: LanguageSelectorProps) => {
  const intl = useIntl();
  const { data: languages } = useSWR<Language[]>('/api/v1/languages');

  const sortedLanguages = useMemo(() => {
    languages?.forEach((language) => {
      language.name =
        intl.formatDisplayName(language.iso_639_1, {
          type: 'language',
          fallback: 'none',
        }) ?? language.english_name;
    });

    return [...(languages ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [intl, languages]);

  const languageName = (languageCode: string) =>
    sortedLanguages?.find((language) => language.iso_639_1 === languageCode)
      ?.name ?? languageCode;

  const options: OptionType[] =
    sortedLanguages?.map((language) => ({
      label: language.name,
      value: language.iso_639_1,
    })) ?? [];

  if (isUserSettings && !compact) {
    options.unshift({
      value: 'server',
      label: intl.formatMessage(messages.languageServerDefault, {
        language: serverValue
          ? serverValue
              .split('|')
              .map((value) => languageName(value))
              .reduce((prev, curr) =>
                intl.formatMessage(globalMessages.delimitedlist, {
                  a: prev,
                  b: curr,
                })
              )
          : intl.formatMessage(messages.originalLanguageDefault),
      }),
      isFixed: true,
    });
  }

  options.unshift({
    value: 'all',
    label: intl.formatMessage(
      compact ? messages.any : messages.originalLanguageDefault
    ),
    isFixed: true,
  });

  return (
    <Select<OptionType, true>
      options={options}
      isMulti
      isDisabled={isDisabled}
      className={`react-select-container language-selector ${compact ? 'discover-compact-select' : 'settings-compatible-react-select'}`}
      classNamePrefix="react-select"
      classNames={{
        multiValueLabel: ({ data }) =>
          data.isFixed ? 'react-select__multi-value__label--fixed' : '',
        multiValueRemove: ({ data }) =>
          data.isFixed ? 'react-select__multi-value__remove--fixed' : '',
      }}
      value={
        (isUserSettings && value === 'all') || (!isUserSettings && !value)
          ? {
              value: 'all',
              label: intl.formatMessage(
                compact ? messages.any : messages.originalLanguageDefault
              ),
              isFixed: true,
            }
          : (value === '' || !value || value === 'server') && isUserSettings
            ? {
                value: 'server',
                label: intl.formatMessage(messages.languageServerDefault, {
                  language: serverValue
                    ? serverValue
                        .split('|')
                        .map((value) => languageName(value))
                        .reduce((prev, curr) =>
                          intl.formatMessage(globalMessages.delimitedlist, {
                            a: prev,
                            b: curr,
                          })
                        )
                    : intl.formatMessage(messages.originalLanguageDefault),
                }),
                isFixed: true,
              }
            : (value
                ?.split('|')
                .map((code) => {
                  const matchedLanguage = sortedLanguages?.find(
                    (lang) => lang.iso_639_1 === code
                  );

                  if (!matchedLanguage) {
                    return undefined;
                  }

                  return {
                    label: matchedLanguage.name,
                    value: matchedLanguage.iso_639_1,
                  };
                })
                .filter((option) => option !== undefined) as OptionType[])
      }
      onChange={(value, options) => {
        if (
          (options &&
            options.action === 'select-option' &&
            options.option?.value === 'server') ||
          value.every((v) => v.value === 'server')
        ) {
          return setFieldValue(fieldName, '');
        }

        if (
          (options &&
            options.action === 'select-option' &&
            options.option?.value === 'all') ||
          value.every((v) => v.value === 'all')
        ) {
          return setFieldValue(fieldName, isUserSettings ? 'all' : '');
        }

        setFieldValue(
          fieldName,
          value
            .map((lang) => lang.value)
            .filter((v) => v !== 'all')
            .join('|')
        );
      }}
    />
  );
};

export default LanguageSelector;
