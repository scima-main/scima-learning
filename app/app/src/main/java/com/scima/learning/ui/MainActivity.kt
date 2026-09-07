package com.scima.learning.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.scima.learning.R
import com.scima.learning.ui.create.CreateFragment
import com.scima.learning.ui.discovery.DiscoveryFragment
import com.scima.learning.ui.home.HomeFragment
import com.scima.learning.ui.settings.SettingsFragment
import com.scima.learning.ui.study.StudyFragment

class MainActivity : AppCompatActivity() {
    
    private lateinit var bottomNavigation: BottomNavigationView
    private lateinit var viewPager: ViewPager2
    
    private val fragments = listOf(
        HomeFragment(),
        DiscoveryFragment(),
        CreateFragment(),
        StudyFragment(),
        SettingsFragment()
    )
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        bottomNavigation = findViewById(R.id.bottom_navigation)
        viewPager = findViewById(R.id.view_pager)
        
        setupViewPager()
        setupBottomNavigation()
    }
    
    private fun setupViewPager() {
        viewPager.adapter = ViewPagerAdapter(this, fragments)
        viewPager.isUserInputEnabled = false
        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                super.onPageSelected(position)
                bottomNavigation.menu.getItem(position).isChecked = true
            }
        })
    }
    
    private fun setupBottomNavigation() {
        bottomNavigation.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> {
                    viewPager.currentItem = 0
                    true
                }
                R.id.nav_discovery -> {
                    viewPager.currentItem = 1
                    true
                }
                R.id.nav_create -> {
                    viewPager.currentItem = 2
                    true
                }
                R.id.nav_study -> {
                    viewPager.currentItem = 3
                    true
                }
                R.id.nav_settings -> {
                    viewPager.currentItem = 4
                    true
                }
                else -> false
            }
        }
    }
}
