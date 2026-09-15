import defineMessages from '@app/utils/defineMessages';
import { Listbox, Transition } from '@headlessui/react';
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.MediaQualitySelect', {
  selectQuality: 'Select Quality',
});

interface MediaQualitySelectProps<Quality extends string> {
  value: Quality;
  options: { label: string; value: Quality }[];
  onChange: (quality: Quality) => void;
  className?: string;
  label?: string;
}

const MediaQualitySelect = <Quality extends string>({
  value,
  options,
  onChange,
  className = '',
  label: labelOverride,
}: MediaQualitySelectProps<Quality>) => {
  const intl = useIntl();
  const label = labelOverride ?? intl.formatMessage(messages.selectQuality);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Listbox
      value={selected}
      onChange={(option) => onChange(option.value as Quality)}
    >
      <div className={`relative w-max max-w-full ${className}`}>
        <Listbox.Button
          aria-label={`${label}: ${selected?.label ?? ''}`}
          className="app-button app-button-detail-request button-standard media-quality-select-control group min-w-0"
        >
          <AdjustmentsHorizontalIcon className="flex-none" aria-hidden="true" />
          <span className="truncate">{label}</span>
          <span className="media-quality-select-value font-semibold">
            {selected?.label}
          </span>
          <ChevronDownIcon
            className="media-quality-select-chevron"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="media-quality-select-menu">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                value={option}
                className={({ active }) =>
                  `media-quality-select-option ${
                    active ? 'media-quality-select-option-active' : ''
                  }`
                }
              >
                {({ selected: optionSelected }) => (
                  <>
                    {optionSelected && (
                      <CheckIcon
                        className="media-quality-select-check"
                        aria-hidden="true"
                      />
                    )}
                    <span className="media-quality-select-option-label">
                      {option.label}
                    </span>
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
};

export default MediaQualitySelect;
