import CachedImage from '@app/components/Common/CachedImage';
import Link from 'next/link';
import { useState } from 'react';

interface CompanyCardProps {
  name: string;
  image: string;
  url: string;
  logoTone?: 'color' | 'white';
}

const CompanyCard = ({
  image,
  url,
  name,
  logoTone = 'color',
}: CompanyCardProps) => {
  const [isHovered, setHovered] = useState(false);

  return (
    <Link
      href={url}
      prefetch={false}
      className={`relative flex h-16 w-28 transform-gpu cursor-pointer items-center justify-center p-3 shadow ring-1 transition duration-300 ease-in-out sm:h-[72px] sm:w-36 ${
        isHovered
          ? 'scale-105 bg-gray-700 ring-gray-500'
          : 'scale-100 bg-gray-800 ring-gray-700'
      } rounded-xl`}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setHovered(true);
        }
      }}
      role="link"
      tabIndex={0}
    >
      <div className="relative h-full w-full">
        <CachedImage
          type="tmdb"
          src={image}
          alt={name}
          className={`relative z-40 h-full w-full ${
            logoTone === 'white' ? 'brightness-0 invert' : ''
          }`}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          fill
        />
      </div>
      <div
        className={`absolute right-0 bottom-0 left-0 z-0 h-6 rounded-b-xl bg-gradient-to-t ${
          isHovered ? 'from-gray-800' : 'from-gray-900'
        }`}
      />
    </Link>
  );
};

export default CompanyCard;
