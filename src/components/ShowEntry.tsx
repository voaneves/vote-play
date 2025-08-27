import React, { useState } from 'react';
import TicketIcon from './icons/TicketIcon';

interface ShowEntryProps {
  onLogin: (code: string) => void;
}

const ShowEntry: React.FC<ShowEntryProps> = ({ onLogin }) => {
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(code);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-primary-dark">
      <div className="w-full max-w-sm p-8 space-y-8 bg-background-light rounded-2xl shadow-2xl">
        <div className="text-center">
          <TicketIcon className="mx-auto h-12 w-auto text-highlight-action" />
          <h2 className="mt-6 text-3xl font-bold text-primary-dark">
            Entrar no Show
          </h2>
          <p className="mt-2 text-sm text-text-detail">
            Digite o código fornecido no evento para participar.
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="show-code" className="sr-only">
                Código do Show
              </label>
              <input
                id="show-code"
                name="code"
                type="text"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-4 border border-gray-300 placeholder-gray-500 text-text-detail focus:outline-none focus:ring-highlight-action focus:border-highlight-action focus:z-10 sm:text-sm text-center tracking-widest font-mono uppercase"
                placeholder="EX: ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-highlight-action hover:bg-secondary-highlight focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-highlight-action transition-colors duration-300"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ShowEntry;