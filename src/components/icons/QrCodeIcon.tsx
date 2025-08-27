import React from 'react';

const QrCodeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5v15h15V4.5H3.75zM9 9.75h.008v.008H9v-.008zm5.25 0h.008v.008h-.008v-.008zM9.75 15h.008v.008h-.008V15zm2.25-2.25h.008v.008h-.008v-.008zM15 12.75h.008v.008h-.008v-.008zM15 15h.008v.008h-.008V15z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5v15h15V4.5H3.75zM9 9.75h.008v.008H9v-.008zm5.25 0h.008v.008h-.008v-.008zM9.75 15h.008v.008h-.008V15zm2.25-2.25h.008v.008h-.008v-.008zM15 12.75h.008v.008h-.008v-.008zM15 15h.008v.008h-.008V15zM9 12.75h.008v.008H9v-.008zm-2.25-3h.008v.008h-.008V9.75zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm-3-5.25h.008v.008H3.75V9.75zm0 2.25h.008v.008H3.75v-.008zm0 2.25h.008v.008H3.75V15z" />
  </svg>
);

export default QrCodeIcon;