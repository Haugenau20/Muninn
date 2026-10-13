// src/context/NavigationContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  NavigationPath,
  buildUrl,
  normalizePath,
  formatPath
} from '../utils/navigation';

/**
 * Navigation history entry
 */
interface NavigationHistoryEntry {
  path: string;
  timestamp: number;
}

/**
 * Navigation state interface
 */
interface NavigationState {
  currentPath: string;
  previousPath: string | null;
  navigationStack: NavigationHistoryEntry[];
  queryParams: Record<string, string>;
}

/**
 * Navigation context interface
 */
interface NavigationContextValue {
  /** Current navigation state */
  state: NavigationState;
  /** Navigate to a specific page */
  navigateToPage: (to: string | NavigationPath) => void;
  /** Go back to previous page */
  goBack: () => void;
  /** Update query parameters */
  updateQueryParams: (params: Record<string, string>) => void;
  /** Get current query parameters */
  getCurrentQueryParams: () => Record<string, string>;
  /** Clear navigation history */
  clearHistory: () => void;
  /** Create a navigation path object */
  createPath: (path: string, params?: Record<string, string>, query?: Record<string, string>) => NavigationPath;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

/**
 * Maximum number of entries to keep in navigation history
 */
const MAX_HISTORY_LENGTH = 50;

/**
 * Provider component for navigation functionality
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get query parameters from URL search string
  const parseQueryParams = (search: string): Record<string, string> => {
    const params = new URLSearchParams(search);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  };

  // Initialize state with current location
  const [state, setState] = useState<NavigationState>({
    currentPath: location.pathname,
    previousPath: null,
    navigationStack: [{
      path: location.pathname,
      timestamp: Date.now()
    }],
    queryParams: parseQueryParams(location.search)
  });

  // Update state when location changes
  useEffect(() => {
    setState(prev => {
      const newStack = [...prev.navigationStack];
      
      // Add new entry
      newStack.push({
        path: location.pathname,
        timestamp: Date.now()
      });
      
      // Limit stack size
      if (newStack.length > MAX_HISTORY_LENGTH) {
        newStack.shift();
      }

      return {
        currentPath: location.pathname,
        previousPath: prev.currentPath,
        navigationStack: newStack,
        queryParams: parseQueryParams(location.search)
      };
    });
  }, [location]);

  /**
   * Navigate to a specific page
   */
  const navigateToPage = useCallback((to: string | NavigationPath) => {
    try {
      if (typeof to === 'string') {
        navigate(normalizePath(to));
      } else {
        const url = buildUrl(to.path, to.query || {});
        navigate(url);
      }
    } catch (error) {
      console.error('Navigation error:', error);
      // Fallback to home page on error
      navigate('/');
    }
  }, [navigate]);

  /**
   * Go back to previous page
   */
  const goBack = useCallback(() => {
    if (state.navigationStack.length > 1) {
      const previousEntry = state.navigationStack[state.navigationStack.length - 2];
      navigateToPage(previousEntry.path);
    } else {
      // If no history, go to home
      navigateToPage('/');
    }
  }, [state.navigationStack, navigateToPage]);

  /**
   * Update query parameters
   */
  const updateQueryParams = useCallback((params: Record<string, string>) => {
    const url = buildUrl(state.currentPath, {
      ...state.queryParams,
      ...params
    });
    navigate(url);
  }, [state.currentPath, state.queryParams, navigate]);

  /**
   * Get current query parameters
   */
  const getCurrentQueryParams = useCallback(() => {
    return state.queryParams;
  }, [state.queryParams]);

  /**
   * Clear navigation history
   */
  const clearHistory = useCallback(() => {
    setState(prev => ({
      ...prev,
      navigationStack: [{
        path: prev.currentPath,
        timestamp: Date.now()
      }]
    }));
  }, []);

  /**
   * Create a navigation path object
   */
  const createPath = useCallback((
    path: string,
    params?: Record<string, string>,
    query?: Record<string, string>
  ): NavigationPath => {
    return {
      path: formatPath(path),
      params,
      query
    };
  }, []);

  const value = {
    state,
    navigateToPage,
    goBack,
    updateQueryParams,
    getCurrentQueryParams,
    clearHistory,
    createPath
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

/**
 * Hook to access navigation context
 * @throws {Error} If used outside of NavigationProvider
 */
export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};

/** Going nowhere: what a control inside {@link InertNavigation} calls. */
const stay = () => undefined;

/**
 * The surrounding navigation, except that going anywhere does nothing.
 *
 * For a page drawn from the example campaign (T150's live examples): its
 * rows keep their "More info" and "Open location" looking exactly as they do
 * for a member, and pressing one leaves the visitor where they are, because
 * the records those lead to do not exist. Reading the URL still works, so a
 * deep link's `?highlight=` still finds its row.
 */
export const InertNavigation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const outer = useNavigation();
  const value = useMemo(() => ({ ...outer, navigateToPage: stay, goBack: stay }), [outer]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};
