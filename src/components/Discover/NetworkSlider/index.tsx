import CompanyCard from '@app/components/CompanyCard';
import Slider from '@app/components/Slider';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.NetworkSlider', {
  networks: 'Networks',
});

interface Network {
  name: string;
  image: string;
  url: string;
  logoTone?: 'color' | 'white';
}

export const tvNetworks: Network[] = [
  {
    name: 'Netflix',
    image:
      'https://image.tmdb.org/t/p/original/wwemzKWzjKYJFfCeiB57q3r4Bcm.png',
    url: '/discover/tv/network/213',
  },
  {
    name: 'Disney+',
    image:
      'https://image.tmdb.org/t/p/original/gJ8VX6JSu3ciXHuC2dDGAo2lvwM.png',
    url: '/discover/tv/network/2739',
    logoTone: 'white',
  },
  {
    name: 'Prime Video',
    image:
      'https://image.tmdb.org/t/p/original/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png',
    url: '/discover/tv/network/1024',
  },
  {
    name: 'Apple TV+',
    image:
      'https://image.tmdb.org/t/p/original/4KAy34EHvRM25Ih8wb82AuGU7zJ.png',
    url: '/discover/tv/network/2552',
    logoTone: 'white',
  },
  {
    name: 'Hulu',
    image:
      'https://image.tmdb.org/t/p/original/pqUTCleNUiTLAVlelGxUgWn1ELh.png',
    url: '/discover/tv/network/453',
  },
  {
    name: 'HBO',
    image:
      'https://image.tmdb.org/t/p/original/tuomPhY2UtuPTqqFnKMVHvSb724.png',
    url: '/discover/tv/network/49',
    logoTone: 'white',
  },
  {
    name: 'Discovery+',
    image:
      'https://image.tmdb.org/t/p/original/1D1bS3Dyw4ScYnFWTlBOvJXC3nb.png',
    url: '/discover/tv/network/4353',
  },
  {
    name: 'ABC',
    image:
      'https://image.tmdb.org/t/p/original/ndAvF4JLsliGreX87jAc9GdjmJY.png',
    url: '/discover/tv/network/2',
    logoTone: 'white',
  },
  {
    name: 'FOX',
    image:
      'https://image.tmdb.org/t/p/original/1DSpHrWyOORkL9N2QHX7Adt31mQ.png',
    url: '/discover/tv/network/19',
    logoTone: 'white',
  },
  {
    name: 'Cinemax',
    image:
      'https://image.tmdb.org/t/p/original/6mSHSquNpfLgDdv6VnOOvC5Uz2h.png',
    url: '/discover/tv/network/359',
  },
  {
    name: 'AMC',
    image:
      'https://image.tmdb.org/t/p/original/pmvRmATOCaDykE6JrVoeYxlFHw3.png',
    url: '/discover/tv/network/174',
    logoTone: 'white',
  },
  {
    name: 'Showtime',
    image:
      'https://image.tmdb.org/t/p/original/Allse9kbjiP6ExaQrnSpIhkurEi.png',
    url: '/discover/tv/network/67',
  },
  {
    name: 'Starz',
    image:
      'https://image.tmdb.org/t/p/original/8GJjw3HHsAJYwIWKIPBPfqMxlEa.png',
    url: '/discover/tv/network/318',
    logoTone: 'white',
  },
  {
    name: 'The CW',
    image:
      'https://image.tmdb.org/t/p/original/ge9hzeaU7nMtQ4PjkFlc68dGAJ9.png',
    url: '/discover/tv/network/71',
  },
  {
    name: 'NBC',
    image: 'https://image.tmdb.org/t/p/original/o3OedEP0f9mfZr33jz2BfXOUK5.png',
    url: '/discover/tv/network/6',
  },
  {
    name: 'CBS',
    image:
      'https://image.tmdb.org/t/p/original/nm8d7P7MJNiBLdgIzUK0gkuEA4r.png',
    url: '/discover/tv/network/16',
    logoTone: 'white',
  },
  {
    name: 'Paramount+',
    image: 'https://image.tmdb.org/t/p/original/fi83B1oztoS47xxcemFdPMhIzK.png',
    url: '/discover/tv/network/4330',
  },
  {
    name: 'BBC One',
    image:
      'https://image.tmdb.org/t/p/original/mVn7xESaTNmjBUyUtGNvDQd3CT1.png',
    url: '/discover/tv/network/4',
    logoTone: 'white',
  },
  {
    name: 'Cartoon Network',
    image:
      'https://image.tmdb.org/t/p/original/c5OC6oVCg6QP4eqzW6XIq17CQjI.png',
    url: '/discover/tv/network/56',
    logoTone: 'white',
  },
  {
    name: 'Adult Swim',
    image:
      'https://image.tmdb.org/t/p/original/9AKyspxVzywuaMuZ1Bvilu8sXly.png',
    url: '/discover/tv/network/80',
    logoTone: 'white',
  },
  {
    name: 'Nickelodeon',
    image:
      'https://image.tmdb.org/t/p/original/ikZXxg6GnwpzqiZbRPhJGaZapqB.png',
    url: '/discover/tv/network/13',
  },
  {
    name: 'Peacock',
    image:
      'https://image.tmdb.org/t/p/original/gIAcGTjKKr0KOHL5s4O36roJ8p7.png',
    url: '/discover/tv/network/3353',
    logoTone: 'white',
  },
];

const NetworkSlider = () => {
  const intl = useIntl();
  return (
    <div>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.networks)}</span>
        </div>
      </div>
      <Slider
        compact
        sliderKey="networks"
        isLoading={false}
        isEmpty={false}
        items={tvNetworks.map((network, index) => (
          <CompanyCard
            key={`network-${index}`}
            name={network.name}
            image={network.image}
            url={network.url}
            logoTone={network.logoTone}
          />
        ))}
        placeholder={<CompanyCardPlaceholder />}
        emptyMessage=""
      />
    </div>
  );
};

const CompanyCardPlaceholder = () => (
  <div className="h-16 w-28 animate-pulse rounded-xl bg-gray-700 sm:h-[72px] sm:w-36" />
);

export default NetworkSlider;
