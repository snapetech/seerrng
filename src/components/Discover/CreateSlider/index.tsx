import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import { sliderTitles } from '@app/components/Discover/constants';
import MediaSlider from '@app/components/MediaSlider';
import { WatchProviderSelector } from '@app/components/Selector';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  TmdbCompanySearchResponse,
  TmdbGenre,
  TmdbKeywordSearchResponse,
} from '@server/api/themoviedb/interfaces';
import {
  DiscoverSliderType,
  MAX_DISCOVER_SLIDER_DATA_LENGTH,
  MAX_DISCOVER_SLIDER_TITLE_LENGTH,
} from '@server/constants/discover';
import type DiscoverSlider from '@server/entity/DiscoverSlider';
import type { GenreSliderItem } from '@server/interfaces/api/discoverInterfaces';
import type { Keyword, ProductionCompany } from '@server/models/common';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import AsyncSelect from 'react-select/async';
import * as Yup from 'yup';

const messages = defineMessages('components.Discover.CreateSlider', {
  addSlider: 'Add Slider',
  editSlider: 'Edit Slider',
  slidernameplaceholder: 'Slider Name',
  providetmdbkeywordid: 'Provide a TMDB Keyword ID',
  providetmdbgenreid: 'Provide a TMDB Genre ID',
  providetmdbsearch: 'Provide a search query',
  providetmdbstudio: 'Provide TMDB Studio ID',
  providetmdbnetwork: 'Provide TMDB Network ID',
  providebooksubject: 'Provide an Open Library subject',
  providemusicgenre: 'Provide a MusicBrainz tag',
  providemusicchart: 'Select a ListenBrainz chart',
  addsuccess: 'Created new slider and saved discover customization settings.',
  addfail: 'Failed to create new slider.',
  editsuccess: 'Edited slider and saved discover customization settings.',
  editfail: 'Failed to edit slider.',
  needresults: 'You need to have at least 1 result.',
  validationDatarequired: 'You must provide a data value.',
  validationTitlerequired: 'You must provide a title.',
  validationDataLength: 'Data must be {maxLength, number} characters or fewer.',
  validationTitleLength:
    'Title must be {maxLength, number} characters or fewer.',
  addcustomslider: 'Create Custom Slider',
  searchKeywords: 'Search keywords…',
  searchGenres: 'Search genres…',
  searchStudios: 'Search studios…',
  starttyping: 'Starting typing to search.',
  nooptions: 'No results.',
  fiction: 'Fiction',
  fantasy: 'Fantasy',
  scienceFiction: 'Science Fiction',
  mystery: 'Mystery',
  biography: 'Biography',
  romance: 'Romance',
  history: 'History',
  thriller: 'Thriller',
  alternative: 'Alternative',
  classical: 'Classical',
  country: 'Country',
  electronic: 'Electronic',
  hipHop: 'Hip-Hop',
  jazz: 'Jazz',
  metal: 'Metal',
  pop: 'Pop',
  rock: 'Rock',
  popularWeek: 'Popular This Week',
  popularMonth: 'Popular This Month',
  popularYear: 'Popular This Year',
});

type CreateSliderProps = {
  onCreate: () => void;
  slider?: Partial<DiscoverSlider>;
};

type CreateOption = {
  type: DiscoverSliderType;
  title: string;
  dataUrl: string;
  params?: string;
  titlePlaceholderText: string;
  dataPlaceholderText?: string;
};

const CreateSlider = ({ onCreate, slider }: CreateSliderProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [resultCount, setResultCount] = useState(0);
  const [defaultDataValue, setDefaultDataValue] = useState<
    { label: string; value: number }[] | null
  >(null);

  useEffect(() => {
    if (slider) {
      const loadDefaultKeywords = async (): Promise<void> => {
        if (!slider.data) {
          return;
        }

        const keywords = await Promise.all(
          slider.data.split(',').map(async (keywordId) => {
            const keyword = await axios.get<Keyword | null>(
              `/api/v1/keyword/${keywordId}`
            );
            return keyword.data;
          })
        );

        const validKeywords: Keyword[] = keywords.filter(
          (keyword): keyword is Keyword => keyword !== null
        );

        setDefaultDataValue(
          validKeywords.map((keyword) => ({
            label: keyword.name,
            value: keyword.id,
          }))
        );
      };

      const loadDefaultGenre = async (): Promise<void> => {
        if (!slider.data) {
          return;
        }

        const response = await axios.get<TmdbGenre[]>(
          `/api/v1/genres/${
            slider.type === DiscoverSliderType.TMDB_MOVIE_GENRE ? 'movie' : 'tv'
          }`
        );

        const genre = response.data.find(
          (genre) => genre.id === Number(slider.data)
        );

        setDefaultDataValue([
          {
            label: genre?.name ?? '',
            value: genre?.id ?? 0,
          },
        ]);
      };

      const loadDefaultCompany = async (): Promise<void> => {
        if (!slider.data) {
          return;
        }

        const response = await axios.get<ProductionCompany>(
          `/api/v1/studio/${slider.data}`
        );

        const studio = response.data;

        setDefaultDataValue([
          {
            label: studio.name ?? '',
            value: studio.id ?? 0,
          },
        ]);
      };

      switch (slider.type) {
        case DiscoverSliderType.TMDB_MOVIE_KEYWORD:
        case DiscoverSliderType.TMDB_TV_KEYWORD:
          loadDefaultKeywords();
          break;
        case DiscoverSliderType.TMDB_MOVIE_GENRE:
        case DiscoverSliderType.TMDB_TV_GENRE:
          loadDefaultGenre();
          break;
        case DiscoverSliderType.TMDB_STUDIO:
          loadDefaultCompany();
          break;
      }
    }
  }, [slider]);

  const CreateSliderSchema = Yup.object().shape({
    title: Yup.string()
      .max(
        MAX_DISCOVER_SLIDER_TITLE_LENGTH,
        intl.formatMessage(messages.validationTitleLength, {
          maxLength: MAX_DISCOVER_SLIDER_TITLE_LENGTH,
        })
      )
      .required(intl.formatMessage(messages.validationTitlerequired)),
    data: Yup.string()
      .max(
        MAX_DISCOVER_SLIDER_DATA_LENGTH,
        intl.formatMessage(messages.validationDataLength, {
          maxLength: MAX_DISCOVER_SLIDER_DATA_LENGTH,
        })
      )
      .required(intl.formatMessage(messages.validationDatarequired)),
  });

  const updateResultCount = useCallback(
    (count: number) => {
      setResultCount(count);
    },
    [setResultCount]
  );

  const loadKeywordOptions = async (inputValue: string) => {
    const results = await axios.get<TmdbKeywordSearchResponse>(
      '/api/v1/search/keyword',
      {
        params: {
          query: encodeURIExtraParams(inputValue),
        },
      }
    );

    return results.data.results.map((result) => ({
      label: result.name,
      value: result.id,
    }));
  };

  const loadCompanyOptions = async (inputValue: string) => {
    if (inputValue === '') {
      return [];
    }

    const results = await axios.get<TmdbCompanySearchResponse>(
      '/api/v1/search/company',
      {
        params: {
          query: encodeURIExtraParams(inputValue),
        },
      }
    );

    return results.data.results.map((result) => ({
      label: result.name,
      value: result.id,
    }));
  };

  const loadMovieGenreOptions = async () => {
    const results = await axios.get<GenreSliderItem[]>(
      '/api/v1/discover/genreslider/movie'
    );

    return results.data.map((result) => ({
      label: result.name,
      value: result.id,
    }));
  };

  const loadTvGenreOptions = async () => {
    const results = await axios.get<GenreSliderItem[]>(
      '/api/v1/discover/genreslider/tv'
    );

    return results.data.map((result) => ({
      label: result.name,
      value: result.id,
    }));
  };

  const bookSubjectOptions = [
    { label: intl.formatMessage(messages.fiction), value: 'fiction' },
    { label: intl.formatMessage(messages.fantasy), value: 'fantasy' },
    {
      label: intl.formatMessage(messages.scienceFiction),
      value: 'science_fiction',
    },
    { label: intl.formatMessage(messages.mystery), value: 'mystery' },
    { label: intl.formatMessage(messages.biography), value: 'biography' },
    { label: intl.formatMessage(messages.romance), value: 'romance' },
    { label: intl.formatMessage(messages.history), value: 'history' },
    { label: intl.formatMessage(messages.thriller), value: 'thriller' },
  ];

  const musicGenreOptions = [
    { label: intl.formatMessage(messages.alternative), value: 'alternative' },
    { label: intl.formatMessage(messages.classical), value: 'classical' },
    { label: intl.formatMessage(messages.country), value: 'country' },
    { label: intl.formatMessage(messages.electronic), value: 'electronic' },
    { label: intl.formatMessage(messages.hipHop), value: 'hip hop' },
    { label: intl.formatMessage(messages.jazz), value: 'jazz' },
    { label: intl.formatMessage(messages.metal), value: 'metal' },
    { label: intl.formatMessage(messages.pop), value: 'pop' },
    { label: intl.formatMessage(messages.rock), value: 'rock' },
  ];

  const musicChartOptions = [
    { label: intl.formatMessage(messages.popularWeek), value: 'popular.week' },
    {
      label: intl.formatMessage(messages.popularMonth),
      value: 'popular.month',
    },
    { label: intl.formatMessage(messages.popularYear), value: 'popular.year' },
  ];

  const options: CreateOption[] = [
    {
      type: DiscoverSliderType.TMDB_MOVIE_KEYWORD,
      title: intl.formatMessage(sliderTitles.tmdbmoviekeyword),
      dataUrl: '/api/v1/discover/movies',
      params: 'keywords=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbkeywordid),
    },
    {
      type: DiscoverSliderType.TMDB_TV_KEYWORD,
      title: intl.formatMessage(sliderTitles.tmdbtvkeyword),
      dataUrl: '/api/v1/discover/tv',
      params: 'keywords=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbkeywordid),
    },
    {
      type: DiscoverSliderType.TMDB_MOVIE_GENRE,
      title: intl.formatMessage(sliderTitles.tmdbmoviegenre),
      dataUrl: '/api/v1/discover/movies',
      params: 'genre=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbgenreid),
    },
    {
      type: DiscoverSliderType.TMDB_TV_GENRE,
      title: intl.formatMessage(sliderTitles.tmdbtvgenre),
      dataUrl: '/api/v1/discover/tv',
      params: 'genre=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbgenreid),
    },
    {
      type: DiscoverSliderType.TMDB_STUDIO,
      title: intl.formatMessage(sliderTitles.tmdbstudio),
      dataUrl: '/api/v1/discover/movies/studio/$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbstudio),
    },
    {
      type: DiscoverSliderType.TMDB_NETWORK,
      title: intl.formatMessage(sliderTitles.tmdbnetwork),
      dataUrl: '/api/v1/discover/tv/network/$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbnetwork),
    },
    {
      type: DiscoverSliderType.TMDB_SEARCH,
      title: intl.formatMessage(sliderTitles.tmdbsearch),
      dataUrl: '/api/v1/search',
      params: 'query=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providetmdbsearch),
    },
    {
      type: DiscoverSliderType.TMDB_MOVIE_STREAMING_SERVICES,
      title: intl.formatMessage(sliderTitles.tmdbmoviestreamingservices),
      dataUrl: '/api/v1/discover/movies',
      params: 'watchRegion=$regionValue&watchProviders=$providersValue',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
    },
    {
      type: DiscoverSliderType.TMDB_TV_STREAMING_SERVICES,
      title: intl.formatMessage(sliderTitles.tmdbtvstreamingservices),
      dataUrl: '/api/v1/discover/tv',
      params: 'watchRegion=$regionValue&watchProviders=$providersValue',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
    },
    {
      type: DiscoverSliderType.OPENLIBRARY_BOOK_SUBJECT,
      title: intl.formatMessage(sliderTitles.openlibrarybooksubject),
      dataUrl: '/api/v1/discover/books',
      params: 'subject=$value&sortBy=ranked',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providebooksubject),
    },
    {
      type: DiscoverSliderType.MUSICBRAINZ_MUSIC_GENRE,
      title: intl.formatMessage(sliderTitles.musicbrainzmusicgenre),
      dataUrl: '/api/v1/discover/music',
      params: 'genre=$value&sortBy=ranked',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providemusicgenre),
    },
    {
      type: DiscoverSliderType.LISTENBRAINZ_MUSIC_CHART,
      title: intl.formatMessage(sliderTitles.listenbrainzmusicchart),
      dataUrl: '/api/v1/discover/music',
      params: 'sortBy=$value',
      titlePlaceholderText: intl.formatMessage(messages.slidernameplaceholder),
      dataPlaceholderText: intl.formatMessage(messages.providemusicchart),
    },
  ];

  return (
    <Formik
      initialValues={
        slider
          ? {
              sliderType: slider.type,
              title: slider.title,
              data: slider.data,
            }
          : {
              sliderType: DiscoverSliderType.TMDB_MOVIE_KEYWORD,
              title: '',
              data: '',
            }
      }
      validationSchema={CreateSliderSchema}
      enableReinitialize
      onSubmit={async (values, { resetForm }) => {
        try {
          if (slider) {
            await axios.put(`/api/v1/settings/discover/${slider.id}`, {
              type: Number(values.sliderType),
              title: values.title,
              data: values.data,
            });
          } else {
            await axios.post('/api/v1/settings/discover/add', {
              type: Number(values.sliderType),
              title: values.title,
              data: values.data,
            });
          }

          addToast(
            intl.formatMessage(
              slider ? messages.editsuccess : messages.addsuccess
            ),
            {
              appearance: 'success',
              autoDismiss: true,
            }
          );
          onCreate();
          resetForm();
        } catch {
          addToast(
            intl.formatMessage(slider ? messages.editfail : messages.addfail),
            {
              appearance: 'error',
              autoDismiss: true,
            }
          );
        }
      }}
    >
      {({ values, isValid, isSubmitting, errors, touched, setFieldValue }) => {
        const activeOption = options.find(
          (option) => option.type === Number(values.sliderType)
        );

        let dataInput: React.ReactNode;

        switch (activeOption?.type) {
          case DiscoverSliderType.TMDB_MOVIE_KEYWORD:
          case DiscoverSliderType.TMDB_TV_KEYWORD:
            dataInput = (
              <AsyncSelect
                key={`keyword-select-${defaultDataValue}`}
                inputId="data"
                isMulti
                className="react-select-container"
                classNamePrefix="react-select"
                noOptionsMessage={({ inputValue }) =>
                  inputValue === ''
                    ? intl.formatMessage(messages.starttyping)
                    : intl.formatMessage(messages.nooptions)
                }
                defaultValue={defaultDataValue}
                loadOptions={loadKeywordOptions}
                placeholder={intl.formatMessage(messages.searchKeywords)}
                onChange={(value) => {
                  const keywords = value.map((item) => item.value).join(',');

                  setFieldValue('data', keywords);
                }}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_GENRE:
            dataInput = (
              <AsyncSelect
                key={`movie-genre-select-${defaultDataValue}`}
                className="react-select-container"
                classNamePrefix="react-select"
                defaultValue={defaultDataValue?.[0]}
                defaultOptions
                cacheOptions
                loadOptions={loadMovieGenreOptions}
                placeholder={intl.formatMessage(messages.searchGenres)}
                onChange={(value) => {
                  setFieldValue('data', value?.value.toString());
                }}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_GENRE:
            dataInput = (
              <AsyncSelect
                key={`tv-genre-select-${defaultDataValue}}`}
                className="react-select-container"
                classNamePrefix="react-select"
                defaultValue={defaultDataValue?.[0]}
                defaultOptions
                cacheOptions
                loadOptions={loadTvGenreOptions}
                placeholder={intl.formatMessage(messages.searchGenres)}
                onChange={(value) => {
                  setFieldValue('data', value?.value.toString());
                }}
              />
            );
            break;
          case DiscoverSliderType.TMDB_STUDIO:
            dataInput = (
              <AsyncSelect
                key={`studio-select-${defaultDataValue}`}
                className="react-select-container"
                classNamePrefix="react-select"
                defaultValue={defaultDataValue?.[0]}
                defaultOptions
                cacheOptions
                loadOptions={loadCompanyOptions}
                placeholder={intl.formatMessage(messages.searchStudios)}
                onChange={(value) => {
                  setFieldValue('data', value?.value.toString());
                }}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_STREAMING_SERVICES:
            dataInput = (
              <WatchProviderSelector
                type={'movie'}
                region={slider?.data?.split(',')[0]}
                activeProviders={
                  slider?.data
                    ?.split(',')[1]
                    .split('|')
                    .map((v) => Number(v)) ?? []
                }
                onChange={(region, providers) => {
                  setFieldValue('data', `${region},${providers.join('|')}`);
                }}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_STREAMING_SERVICES:
            dataInput = (
              <WatchProviderSelector
                type={'tv'}
                region={slider?.data?.split(',')[0]}
                activeProviders={
                  slider?.data
                    ?.split(',')[1]
                    .split('|')
                    .map((v) => Number(v)) ?? []
                }
                onChange={(region, providers) => {
                  setFieldValue('data', `${region},${providers.join('|')}`);
                }}
              />
            );
            break;
          case DiscoverSliderType.OPENLIBRARY_BOOK_SUBJECT:
            dataInput = (
              <Field as="select" name="data" id="data">
                <option value="">{activeOption.dataPlaceholderText}</option>
                {bookSubjectOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </Field>
            );
            break;
          case DiscoverSliderType.MUSICBRAINZ_MUSIC_GENRE:
            dataInput = (
              <Field as="select" name="data" id="data">
                <option value="">{activeOption.dataPlaceholderText}</option>
                {musicGenreOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </Field>
            );
            break;
          case DiscoverSliderType.LISTENBRAINZ_MUSIC_CHART:
            dataInput = (
              <Field as="select" name="data" id="data">
                <option value="">{activeOption.dataPlaceholderText}</option>
                {musicChartOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </Field>
            );
            break;
          default:
            dataInput = (
              <Field
                type="text"
                name="data"
                id="data"
                placeholder={activeOption?.dataPlaceholderText}
              />
            );
        }

        return (
          <Form data-testid="create-discover-option-form">
            <div className="flex flex-col space-y-2 text-gray-100">
              <Field as="select" id="sliderType" name="sliderType">
                {options.map((option) => (
                  <option value={option.type} key={`type-${option.type}`}>
                    {option.title}
                  </option>
                ))}
              </Field>
              <Field
                type="text"
                name="title"
                id="title"
                placeholder={activeOption?.titlePlaceholderText}
              />
              {errors.title &&
                touched.title &&
                typeof errors.title === 'string' && (
                  <div className="error">{errors.title}</div>
                )}
              {dataInput}
              {errors.data &&
                touched.data &&
                typeof errors.data === 'string' && (
                  <div className="error">{errors.data}</div>
                )}
              <div className="flex-1" />
              {resultCount === 0 ? (
                <Tooltip content={intl.formatMessage(messages.needresults)}>
                  <div>
                    <Button buttonType="primary" buttonSize="sm" disabled>
                      {intl.formatMessage(messages.addSlider)}
                    </Button>
                  </div>
                </Tooltip>
              ) : (
                <div>
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    disabled={isSubmitting || !isValid}
                  >
                    {intl.formatMessage(
                      slider ? messages.editSlider : messages.addSlider
                    )}
                  </Button>
                </div>
              )}
            </div>

            {activeOption && values.title && values.data && (
              <div className="relative py-4">
                <MediaSlider
                  sliderKey={`preview-${values.title}`}
                  title={values.title}
                  url={activeOption?.dataUrl.replace(
                    '$value',
                    encodeURIExtraParams(values.data)
                  )}
                  extraParams={
                    activeOption.type ===
                      DiscoverSliderType.TMDB_MOVIE_STREAMING_SERVICES ||
                    activeOption.type ===
                      DiscoverSliderType.TMDB_TV_STREAMING_SERVICES
                      ? activeOption.params
                          ?.replace(
                            '$regionValue',
                            encodeURIExtraParams(values?.data.split(',')[0])
                          )
                          .replace(
                            '$providersValue',
                            encodeURIExtraParams(values?.data.split(',')[1])
                          )
                      : activeOption.params?.replace(
                          '$value',
                          encodeURIExtraParams(values.data)
                        )
                  }
                  randomizeOrder={activeOption.params?.includes(
                    'sortBy=ranked'
                  )}
                  onNewTitles={updateResultCount}
                />
              </div>
            )}
          </Form>
        );
      }}
    </Formik>
  );
};

export default CreateSlider;
