import { Listbox, Transition } from '@headlessui/react';
import { StarIcon as OutlineStarIcon } from '@heroicons/react/24/outline';
import {
  CheckIcon,
  ChevronDownIcon,
  StarIcon as SolidStarIcon,
} from '@heroicons/react/24/solid';
import { Fragment } from 'react';

export const getFilterResetButtonClass = (selected: boolean) =>
  `app-filter-button ${
    selected ? 'app-filter-button-active' : 'app-filter-reset-button-idle'
  }`;

export const getFilterToggleButtonClass = (selected: boolean) =>
  `app-filter-button ${
    selected ? 'app-filter-button-active' : 'app-filter-button-idle'
  }`;

export type CompactSelectOption = {
  label: string;
  value: string;
};

export type RangeOption = CompactSelectOption & {
  gte?: string;
  lte?: string;
};

export type RatingOption = RangeOption & {
  score?: number;
};

type CompactSelectProps = {
  label: string;
  value: string;
  options: CompactSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  defaultValue?: string;
};

export const CompactSelect = ({
  label,
  value,
  options,
  onChange,
  className = '',
  defaultValue,
}: CompactSelectProps) => {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const isActive = value !== (defaultValue ?? options[0]?.value);

  return (
    <Listbox value={selected} onChange={(option) => onChange(option.value)}>
      <div className={`discover-filter-control relative ${className}`}>
        <span
          className={`discover-filter-control-label ${
            isActive ? 'discover-filter-control-label-active' : ''
          }`}
        >
          {label}
        </span>
        <Listbox.Button
          aria-label={label}
          className="app-control-shadow-exempt app-filter-select-trigger"
        >
          <span className="max-w-48 truncate">{selected.label}</span>
          <ChevronDownIcon
            className="app-filter-select-chevron"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="app-filter-select-menu">
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                value={option}
                className={({ active }) =>
                  `app-filter-select-option ${
                    active ? 'app-filter-select-option-active' : ''
                  }`
                }
              >
                {({ selected: optionSelected }) => (
                  <>
                    {optionSelected && (
                      <CheckIcon
                        className="app-filter-select-check"
                        aria-hidden="true"
                      />
                    )}
                    <span className="block truncate">{option.label}</span>
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

const RatingStars = ({
  score,
  maxScore,
}: {
  score: number;
  maxScore: 5 | 10;
}) => (
  <span className="inline-flex gap-px" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((starIndex) => {
      const fill = Math.max(0, Math.min(1, (score / maxScore) * 5 - starIndex));

      return (
        <span key={starIndex} className="relative h-3.5 w-3.5">
          <OutlineStarIcon className="absolute h-3.5 w-3.5 text-gray-500" />
          {fill > 0 && (
            <span
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <SolidStarIcon className="h-3.5 w-3.5 max-w-none text-yellow-400" />
            </span>
          )}
        </span>
      );
    })}
  </span>
);

type CompactRatingSelectProps = {
  label: string;
  value: string;
  options: RatingOption[];
  onChange: (value: string) => void;
  maxScore?: 5 | 10;
  className?: string;
  defaultValue?: string;
};

export const CompactRatingSelect = ({
  label,
  value,
  options,
  onChange,
  maxScore = 10,
  className = '',
  defaultValue,
}: CompactRatingSelectProps) => {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const selectedHasScore = selected.score !== undefined;
  const isActive = value !== (defaultValue ?? options[0]?.value);

  return (
    <Listbox value={selected} onChange={(option) => onChange(option.value)}>
      <div className={`discover-filter-control relative ${className}`}>
        <span
          className={`discover-filter-control-label ${
            isActive ? 'discover-filter-control-label-active' : ''
          }`}
        >
          {label}
        </span>
        <Listbox.Button
          aria-label={label}
          className="app-control-shadow-exempt app-filter-select-trigger app-filter-select-trigger-rating"
        >
          {selectedHasScore ? (
            <RatingStars score={selected.score ?? 0} maxScore={maxScore} />
          ) : (
            <span className="max-w-48 truncate text-left">
              {selected.label}
            </span>
          )}
          <ChevronDownIcon
            className="app-filter-select-chevron"
            aria-hidden="true"
          />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="app-filter-select-menu app-filter-rating-menu">
            {options.map((option) => {
              const hasScore = option.score !== undefined;

              return (
                <Listbox.Option
                  key={option.value}
                  value={option}
                  className={({ active }) =>
                    `app-filter-select-option app-filter-rating-option ${
                      active ? 'app-filter-select-option-active' : ''
                    }`
                  }
                >
                  {({ selected: optionSelected }) => (
                    <>
                      {optionSelected && (
                        <CheckIcon
                          className="app-filter-select-check"
                          aria-hidden="true"
                        />
                      )}
                      {hasScore ? (
                        <RatingStars
                          score={option.score ?? 0}
                          maxScore={maxScore}
                        />
                      ) : (
                        <span className="block truncate">{option.label}</span>
                      )}
                    </>
                  )}
                </Listbox.Option>
              );
            })}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
};
