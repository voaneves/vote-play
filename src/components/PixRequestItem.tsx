import React from 'react';
import { PixRequest } from '@/types';

interface PixRequestItemProps {
  request: PixRequest;
  index: number;
}

const PixRequestItem: React.FC<PixRequestItemProps> = ({ request, index }) => (
  <li className="flex items-center justify-between bg-white/80 p-4 rounded-lg shadow-md">
    <div className="flex items-center">
      <span className="text-lg font-bold text-secondary-highlight mr-4">
        #{index + 1}
      </span>
      <div>
        <h4 className="font-bold text-primary-dark">{request.title}</h4>
        <p className="text-sm text-text-detail">{request.artist}</p>
      </div>
    </div>
    <div className="text-right">
      <span className="font-semibold text-lg text-primary-dark">
        R$ {request.amount.toFixed(2)}
      </span>
      <p className="text-xs text-text-detail/80">por {request.user}</p>
    </div>
  </li>
);

export default PixRequestItem;