import { defineMessages } from '@server/i18n';

const globalMessages = defineMessages('notifications.common', {
  requestedBy: 'Requested By',
  requestStatus: 'Request Status',
  pendingApproval: 'Pending Approval',
  processing: 'Processing',
  available: 'Available',
  declined: 'Declined',
  failed: 'Failed',
  commentFrom: 'Comment from {userName}',
  reportedBy: 'Reported By',
  issueType: 'Issue Type',
  issueStatus: 'Issue Status',
  open: 'Open',
  resolved: 'Resolved',
  viewIssue: 'View Issue in {applicationTitle}',
  viewRequestStatus: 'View Request Status in {applicationTitle}',
  softwareRequestAvailable: 'Software Request Available',
  softwareAvailableMessage:
    'Your requested software is ready. Open Request Status to download a copy.',
  softwareRequestPending: 'Software Request Pending Approval',
  softwarePendingMessage: 'A software request is waiting for approval.',
  softwareRequestApproved: 'Software Request Approved',
  softwareApprovedMessage:
    'Your software request was approved and sent to its acquisition provider.',
  softwareRequestDeclined: 'Software Request Declined',
  softwareDeclinedMessage: 'Your software request was declined.',
  softwareRequestFailed: 'Software Request Failed',
  softwareFailedMessage:
    'The acquisition provider could not complete this software request. A retry may be available in Request Status.',
  viewMedia: 'View Media in {applicationTitle}',
  openIn: 'Open in {applicationTitle}',
  movie: 'movie',
  series: 'series',
  music: 'music',
  book: 'book',
  comic: 'comic',
  magazine: 'magazine',
  issue: 'issue',
  issueTypeName: '{type} issue',
});

export default globalMessages;
