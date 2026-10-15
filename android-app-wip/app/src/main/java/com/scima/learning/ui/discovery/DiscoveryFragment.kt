package com.scima.learning.ui.discovery

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.search.SearchBar
import com.google.android.material.textfield.TextInputEditText
import com.scima.learning.R
import com.scima.learning.model.Deck

class DiscoveryFragment : Fragment() {
    
    private lateinit var viewModel: DiscoveryViewModel
    private lateinit var deckAdapter: DiscoveryDeckAdapter
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var searchBar: SearchBar
    
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_discovery, container, false)
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        viewModel = ViewModelProvider(this)[DiscoveryViewModel::class.java]
        
        swipeRefresh = view.findViewById(R.id.swipe_refresh)
        searchBar = view.findViewById(R.id.search_bar)
        val recyclerView = view.findViewById<RecyclerView>(R.id.recycler_view_decks)
        val errorView = view.findViewById<View>(R.id.error_view)
        val loadingView = view.findViewById<View>(R.id.loading_view)
        
        deckAdapter = DiscoveryDeckAdapter { deck ->
            onDeckSelected(deck)
        }
        
        recyclerView.adapter = deckAdapter
        recyclerView.layoutManager = LinearLayoutManager(requireContext())
        
        // Search functionality
        searchBar.setOnQueryTextListener { query ->
            viewModel.searchDecks(query)
            true
        }
        
        // Pull to refresh
        swipeRefresh.setOnRefreshListener {
            viewModel.loadFeaturedDecks()
        }
        
        // Observe state
        viewModel.decks.observe(viewLifecycleOwner) { decks ->
            deckAdapter.submitList(decks)
            swipeRefresh.isRefreshing = false
            loadingView.visibility = View.GONE
            errorView.visibility = View.GONE
            recyclerView.visibility = View.VISIBLE
        }
        
        viewModel.isLoading.observe(viewLifecycleOwner) { isLoading ->
            if (isLoading && !swipeRefresh.isRefreshing) {
                loadingView.visibility = View.VISIBLE
                recyclerView.visibility = View.GONE
                errorView.visibility = View.GONE
            }
        }
        
        viewModel.error.observe(viewLifecycleOwner) { error ->
            if (error != null) {
                errorView.visibility = View.VISIBLE
                recyclerView.visibility = View.GONE
                loadingView.visibility = View.GONE
                swipeRefresh.isRefreshing = false
                
                view.findViewById<com.google.android.material.button.MaterialButton>(R.id.retry_button)
                    .setOnClickListener {
                        viewModel.loadFeaturedDecks()
                    }
            }
        }
        
        // Initial load
        viewModel.loadFeaturedDecks()
    }
    
    private fun onDeckSelected(deck: Deck) {
        Toast.makeText(requireContext(), "Downloading deck: ${deck.title}", Toast.LENGTH_SHORT).show()
        viewModel.downloadDeck(deck)
    }
}
