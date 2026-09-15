import Button from '@app/components/Common/Button';
import TitleCard from '@app/components/TitleCard';
import globalMessages from '@app/i18n/globalMessages';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useIntl } from 'react-intl';

interface SliderProps {
  sliderKey: string;
  items?: JSX.Element[];
  isLoading: boolean;
  isEmpty?: boolean;
  emptyMessage?: React.ReactNode;
  placeholder?: React.ReactNode;
  compact?: boolean;
}

enum Direction {
  RIGHT,
  LEFT,
}

const Slider = ({
  sliderKey,
  items,
  isLoading,
  isEmpty = false,
  emptyMessage,
  placeholder = <TitleCard.Placeholder />,
  compact = false,
}: SliderProps) => {
  const intl = useIntl();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const [scrollPos, setScrollPos] = useState({ isStart: true, isEnd: false });
  const scrollPosRef = useRef(scrollPos);

  const setScrollPosition = useCallback(
    (nextScrollPos: { isStart: boolean; isEnd: boolean }) => {
      if (
        scrollPosRef.current.isStart === nextScrollPos.isStart &&
        scrollPosRef.current.isEnd === nextScrollPos.isEnd
      ) {
        return;
      }

      scrollPosRef.current = nextScrollPos;
      setScrollPos(nextScrollPos);
    },
    []
  );

  const handleScroll = useCallback(() => {
    const margin = 5;
    const scrollWidth = containerRef.current?.scrollWidth ?? 0;
    const clientWidth =
      containerRef.current?.getBoundingClientRect().width ?? 0;
    const scrollPosition = containerRef.current?.scrollLeft ?? 0;

    if (!items || items?.length === 0) {
      setScrollPosition({ isStart: true, isEnd: true });
    } else if (clientWidth >= scrollWidth) {
      setScrollPosition({ isStart: true, isEnd: true });
    } else if (
      scrollPosition >=
      (containerRef.current?.scrollWidth ?? 0) - clientWidth - margin
    ) {
      setScrollPosition({ isStart: false, isEnd: true });
    } else if (scrollPosition > margin) {
      setScrollPosition({ isStart: false, isEnd: false });
    } else {
      setScrollPosition({ isStart: true, isEnd: false });
    }
  }, [items, setScrollPosition]);

  const debouncedScroll = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(handleScroll, 50);
  }, [handleScroll]);

  useEffect(() => {
    const handleResize = () => {
      debouncedScroll();
    };

    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.clearTimeout(debounceRef.current);
    };
  }, [debouncedScroll]);

  useEffect(() => {
    handleScroll();
  }, [items, handleScroll]);

  const onScroll = () => {
    debouncedScroll();
  };

  const slide = (direction: Direction) => {
    const clientWidth =
      containerRef.current?.getBoundingClientRect().width ?? 0;
    const cardWidth =
      containerRef.current?.firstElementChild?.getBoundingClientRect().width ??
      0;
    const scrollPosition = containerRef.current?.scrollLeft ?? 0;
    const scrollWidth = containerRef.current?.scrollWidth ?? 0;

    if (!containerRef.current || !clientWidth || !cardWidth) {
      return;
    }

    const visibleItems = Math.floor(clientWidth / cardWidth);
    const scrollOffset = scrollPosition % cardWidth;

    if (direction === Direction.LEFT) {
      const newX = Math.max(
        scrollPosition - scrollOffset - visibleItems * cardWidth,
        0
      );
      containerRef.current.scrollTo({ left: newX, behavior: 'smooth' });

      if (newX === 0) {
        setScrollPosition({ isStart: true, isEnd: false });
      } else {
        setScrollPosition({ isStart: false, isEnd: false });
      }
    } else if (direction === Direction.RIGHT) {
      const newX = Math.min(
        scrollPosition - scrollOffset + visibleItems * cardWidth,
        scrollWidth - clientWidth
      );
      containerRef.current.scrollTo({ left: newX, behavior: 'smooth' });

      if (newX >= scrollWidth - clientWidth) {
        setScrollPosition({ isStart: false, isEnd: true });
      } else {
        setScrollPosition({ isStart: false, isEnd: false });
      }
    }
  };

  return (
    <div className="relative" data-testid="media-slider">
      <div className="absolute right-0 -mt-10 flex gap-1 text-gray-400">
        <Button
          buttonType="success"
          buttonSize="sm"
          className="h-8 w-8 p-0 disabled:text-gray-600"
          onClick={() => slide(Direction.LEFT)}
          disabled={scrollPos.isStart}
          disabledReason={intl.formatMessage(globalMessages.noPreviousItems)}
          type="button"
          aria-label={intl.formatMessage(globalMessages.previous)}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </Button>
        <Button
          buttonType="success"
          buttonSize="sm"
          className="h-8 w-8 p-0 disabled:text-gray-600"
          onClick={() => slide(Direction.RIGHT)}
          disabled={scrollPos.isEnd}
          disabledReason={intl.formatMessage(globalMessages.noNextItems)}
          type="button"
          aria-label={intl.formatMessage(globalMessages.next)}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>
      <div
        className={`slider-track hide-scrollbar relative -my-2 -mr-4 -ml-4 overflow-x-scroll overflow-y-auto overscroll-x-contain px-2 py-2 whitespace-nowrap ${
          compact
            ? 'slider-track-compact min-h-[5.5rem]'
            : 'min-h-[13.5rem] md:min-h-[17rem]'
        }`}
        ref={containerRef}
        onScroll={onScroll}
      >
        {items?.map((item, index) => (
          <div
            key={`${sliderKey}-${index}`}
            className={`slider-item inline-block px-2 align-top ${compact ? 'slider-item-compact' : ''}`}
          >
            {item}
          </div>
        ))}
        {isLoading &&
          [...Array(10)].map((_item, i) => (
            <div
              key={`placeholder-${i}`}
              className={`slider-item inline-block px-2 align-top ${compact ? 'slider-item-compact' : ''}`}
            >
              {placeholder}
            </div>
          ))}
        {isEmpty && (
          <div className="mt-16 mb-16 text-center font-medium text-gray-300">
            {emptyMessage
              ? emptyMessage
              : intl.formatMessage(globalMessages.noresults)}
          </div>
        )}
      </div>
    </div>
  );
};

export default Slider;
